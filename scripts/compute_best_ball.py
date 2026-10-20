"""
Weekly commentary helper (read-only - writes nothing to the site's data files).

Pulls each played week's ESPN box scores and prints, for the weekly recap:
  - Best-ball standings: every team AND every opponent plays its highest-scoring legal lineup
    from that week's roster (slots from ESPN's lineupSlotCounts; IR excluded; each player's own
    eligibleSlots), compared with actual records, plus season bench points left on the table.
  - Per-week: started players (non-HC) who scored 0.0 or less, and started Head Coaches who won
    (+5) - both used for weekly Pick'em props.
  - Optional --json PATH dumps everything (incl. each team's optimal lineup) for further digging.

Mid-game injuries: best ball is pure hindsight, so it does NOT protect a starter who got hurt during his
game: the optimal lineup can swap him out like anyone else (Hunter, Oct 20 2026; this used to lock
injured starters in). Those starters are still detected from ESPN's NFL play-by-play ("KC-R.Rice was
injured during the play" with no later "has returned to the game") and printed per week, because
commentary and Fun Facts must never criticize starting them. Pass --lock-injured for the old behavior.

Usage:
  python3 scripts/compute_best_ball.py              # weeks 1 .. last fully played week
  python3 scripts/compute_best_ball.py --through 5
  python3 scripts/compute_best_ball.py --json /tmp/best_ball.json
"""
import argparse
import json
import re
import ssl
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_espn_week as f  # noqa: E402

BENCH, IR, HC = 20, 21, 19

PRO_TEAM_ABBR = {1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB",
                 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO",
                 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB",
                 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU"}
NFL_API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
# Play-by-play team codes that differ from the ESPN fantasy codes above (Week 6 of 2026: "WAS-T.McLaurin was
# injured during the play" never matched the WSH key, so McLaurin wasn't locked into Larson's lineup).
PBP_TEAM = {"WAS": "WSH", "LA": "LAR", "JAC": "JAX"}
SUFFIX = re.compile(r"\s+(jr\.?|sr\.?|ii|iii|iv|v)$", re.I)


def _get_json(url):
    with urllib.request.urlopen(url, context=getattr(f, "SSL_CONTEXT", ssl.create_default_context())) as resp:
        return json.loads(resp.read())


def _short_key(team, full_name):
    """'KC', 'Rashee Rice' -> 'KC-r.rice' (the play-by-play's TEAM-F.Last form, suffixes dropped)."""
    name = SUFFIX.sub("", full_name.strip())
    first, _, last = name.partition(" ")
    return f"{team}-{first[:1]}.{last}".lower().replace(" ", "")


def injured_out(season, week):
    """Set of 'TEAM-f.last' keys for players injured during their game who never returned."""
    board = _get_json(f"{NFL_API}/scoreboard?week={week}&seasontype=2&year={season}")
    out = set()
    hurt_re = re.compile(r"([A-Z]{2,3})-([A-Z][\w'.-]*\.[\w' .-]+?) was injured during the play")
    back_re = re.compile(r"Injury Update: ([A-Z]{2,3})-([A-Z][\w'.-]*\.[\w' .-]+?) has returned to the game")
    for ev in board.get("events", []):
        summary = _get_json(f"{NFL_API}/summary?event={ev['id']}")
        status = {}
        plays = [p for dr in summary.get("drives", {}).get("previous", []) for p in dr.get("plays", [])]
        for play in plays:
            text = play.get("text", "")
            for team, nm in hurt_re.findall(text):
                status[f"{PBP_TEAM.get(team, team)}-{nm}".lower().replace(" ", "")] = "out"
            for team, nm in back_re.findall(text):
                status[f"{PBP_TEAM.get(team, team)}-{nm}".lower().replace(" ", "")] = "back"
        out |= {k for k, v in status.items() if v == "out"}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--league-id", type=int, default=39276)
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--through", type=int, help="last week to include (default: last fully played week)")
    ap.add_argument("--json", help="also write full results to this path")
    ap.add_argument("--lock-injured", action="store_true", help="keep starters hurt mid-game in the optimal lineup (old behavior)")
    args = ap.parse_args()

    creds = f.load_credentials()
    team_map = f.load_team_map()
    base = f.fetch_league_raw(args.league_id, args.season, ["mMatchupScore", "mSettings"], creds)
    counts = base["settings"]["rosterSettings"]["lineupSlotCounts"]
    slots = f.starting_slots(counts)

    if args.through:
        through = args.through
    else:
        played = [m["matchupPeriodId"] for m in base["schedule"] if m.get("winner") not in (None, "UNDECIDED")]
        through = max(played) if played else 0

    actual, best, vs_actual = (defaultdict(lambda: [0, 0, 0]) for _ in range(3))  # W, L, T
    bench_left = defaultdict(float)
    weeks_out = []

    def tally(rec, mgr, mine, theirs):
        rec[mgr][0 if mine > theirs else 1 if mine < theirs else 2] += 1

    for wk in range(1, through + 1):
        d = f.fetch_league_raw(args.league_id, args.season, ["mMatchupScore", f"mBoxscore&scoringPeriodId={wk}"], creds)
        hurt = injured_out(args.season, wk)
        week = {"week": wk, "games": [], "zero_starters": [], "hc_started": [], "injured_starters": []}
        for m in d["schedule"]:
            if m.get("matchupPeriodId") != wk or not m.get("away"):
                continue
            sides = {}
            for side in ("home", "away"):
                t = m[side]
                mgr = f.resolve_manager(t["teamId"], team_map)
                entries = [e for e in t.get("rosterForCurrentScoringPeriod", {}).get("entries", []) if e["lineupSlotId"] != IR]
                pool = tuple(
                    (round(e["playerPoolEntry"].get("appliedStatTotal", 0), 2),
                     tuple(e["playerPoolEntry"]["player"]["eligibleSlots"]),
                     e["playerPoolEntry"]["player"]["fullName"])
                    for e in entries)
                locked = []
                for j, e in enumerate(entries):
                    pl = e["playerPoolEntry"]["player"]
                    team = PRO_TEAM_ABBR.get(pl.get("proTeamId"))
                    if e["lineupSlotId"] not in (BENCH, IR) and team and _short_key(team, pl["fullName"]) in hurt:
                        locked.append((e["lineupSlotId"], j))
                        week["injured_starters"].append({"manager": mgr, "player": pl["fullName"],
                                                         "points": e["playerPoolEntry"].get("appliedStatTotal", 0)})
                opt_pts, opt = f.optimal_lineup(pool, tuple(slots), tuple(locked) if args.lock_injured else ())
                for e in entries:
                    if e["lineupSlotId"] in (BENCH, IR):
                        continue
                    p = e["playerPoolEntry"]
                    if e["lineupSlotId"] == HC:
                        week["hc_started"].append({"manager": mgr, "coach": p["player"]["fullName"], "points": p.get("appliedStatTotal", 0)})
                    elif p.get("appliedStatTotal", 0) <= 0:  # zero OR negative (HCs excluded above)
                        week["zero_starters"].append({"manager": mgr, "player": p["player"]["fullName"],
                                                      "points": round(p.get("appliedStatTotal", 0), 2)})
                actual_pts = round(t.get("totalPoints", 0), 2)
                bench_left[mgr] += opt_pts - actual_pts
                sides[side] = {"manager": mgr, "actual": actual_pts, "optimal": round(opt_pts, 2),
                               "optimal_lineup": [{"slot": s, "player": n, "points": p} for s, n, p in opt]}
            h, a = sides["home"], sides["away"]
            for x, y in ((h, a), (a, h)):
                tally(actual, x["manager"], x["actual"], y["actual"])
                tally(best, x["manager"], x["optimal"], y["optimal"])
                tally(vs_actual, x["manager"], x["optimal"], y["actual"])
            week["games"].append(sides)
        weeks_out.append(week)

    rec = lambda r: f"{r[0]}-{r[1]}" + (f"-{r[2]}" if r[2] else "")
    print(f"Best ball through Week {through} (lineup slots: {slots})\n")
    print(f"{'Manager':12} {'Actual':>7} {'BestBall':>9} {'Opt-vs-Act':>11} {'BenchLeft':>10}")
    for mgr in sorted(actual, key=lambda k: (-best[k][0], -actual[k][0], k)):
        flag = "  *" if rec(actual[mgr]) != rec(best[mgr]) else ""
        print(f"{mgr:12} {rec(actual[mgr]):>7} {rec(best[mgr]):>9} {rec(vs_actual[mgr]):>11} {bench_left[mgr]:>10.1f}{flag}")
    print("\n* = record changes under best ball\n")
    for w in weeks_out:
        flips = [g for g in w["games"] if (g["home"]["actual"] > g["away"]["actual"]) != (g["home"]["optimal"] > g["away"]["optimal"])]
        hc_wins = sum(1 for h in w["hc_started"] if h["points"] > 0)
        biggest = max((s for g in w["games"] for s in g.values()), key=lambda s: s["optimal"] - s["actual"])
        print(f"Week {w['week']}: zero-or-negative starters {len(w['zero_starters'])} "
              f"{[z['manager'] + ': ' + z['player'] + ' ' + format(z['points'], '.1f') for z in w['zero_starters']]}")
        print(f"         HCs started {len(w['hc_started'])}, won {hc_wins}")
        print(f"         starters hurt mid-game (never second-guess these in commentary): "
              f"{[i['manager'] + ': ' + i['player'] + ' ' + format(i['points'], '.1f') for i in w['injured_starters']]}")
        print(f"         biggest bench miss: {biggest['manager']} {biggest['optimal'] - biggest['actual']:.2f}")
        for g in flips:
            print(f"         FLIP: {g['home']['manager']} {g['home']['optimal']} vs {g['away']['manager']} {g['away']['optimal']} "
                  f"(actual {g['home']['actual']}-{g['away']['actual']})")

    if args.json:
        Path(args.json).write_text(json.dumps({
            "through": through, "slots": slots,
            "records": {m: {"actual": rec(actual[m]), "best_ball": rec(best[m]), "optimal_vs_actual": rec(vs_actual[m]),
                            "bench_points_left": round(bench_left[m], 1)} for m in actual},
            "weeks": weeks_out}, indent=2))
        print(f"\nWrote {args.json}")


if __name__ == "__main__":
    main()
