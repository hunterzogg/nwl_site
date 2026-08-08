#!/usr/bin/env python3
"""
Pulls the completed 2026 NWL draft from ESPN, grades every team, and writes
data/season_2026/draft_grades_2026.json for pages/season-2026.html's "2026 Draft" tab.

Unlike fetch_espn_week.py (weekly matchups/standings), this is a one-time pull run once the
real draft has finished - re-running it is safe and just overwrites the output file with a
fresh computation (useful if projections/ADP move before the season starts).

Data pulled:
  1. mDraftDetail (authenticated, same espn_credentials.json as fetch_espn_week.py) - the
     actual picks: teamId, playerId, round, overall pick number, keeper flag.
  2. kona_player_info (public, no auth needed) - the same projections/ADP endpoint the mock
     draft tool uses (see its own HANDOFF.md): each player's 2026 projected points
     (stats[{seasonId:2026,statSourceId:1,statSplitTypeId:0}].appliedTotal) and real crowd ADP
     (ownership.averageDraftPosition). Matched to draft picks by ESPN's numeric player ID -
     more reliable than the mock draft tool's name-matching, since draft picks and this
     endpoint share the same global ESPN player ID space.
  3. Head Coach picks (draftable in this league's format) come back from mDraftDetail with a
     negative playerId encoding the NFL team (-14000 - proTeamId, e.g. -14012 = Chiefs,
     proTeamId 12) since kona_player_info only covers skill-position players, not coaches.
     Projected points/ADP for coaches are read from pages/mock-draft.html's embedded coach
     pool (the same 32-team projected-wins-based dataset that tool already uses) rather than
     re-derived here.

Grading methodology (adapted from pages/mock-draft.html's computeGrades/computePickGrades -
see draft_grades_2026.json's "methodology" field for the exact weights):
  - Starter/bench slotting is NOT read from ESPN's live roster (which changes all season) and
    is NOT just "whoever was drafted into which round" - it's the actual best possible starting
    lineup: every manager's full 15-man draft class is re-assigned to the 9 starting slots (1
    QB, 2 RB, 2 WR, 1 TE, 1 TE/WR flex, 1 FLEX (RB/WR/TE), 1 HC) by projected points, most
    valuable player in each eligible slot wins it - not simply the order things were drafted
    in. Everyone else is bench.
  - Team grade = percentile blend of four signals: (a) starting lineup's total projected points
    - the heaviest-weighted signal, (b) bench's total projected points, (c) ADP reach value
    (draftedAt - adp, round-weighted, across the whole roster), (d) upside (points over each
    position's VBD replacement baseline, round-weighted, across the whole roster - no rookie/
    breakout bonus here, unlike the mock draft tool, since ESPN's live API doesn't expose
    either flag for real players).
  - Position sub-grades (QB/RB/WR/TE/HC) use a separate 3-way blend (points/value/upside,
    points-dominant) scoped to ONLY that position's starters - a bench-buried 4th WR doesn't
    move the WR grade either way. The bench-only grade badge uses the same 3-way blend, scoped
    to a manager's bench-slotted picks regardless of position.

Setup: identical to fetch_espn_week.py - needs scripts/espn_credentials.json (gitignored,
personal ESPN login cookies) already in place. No new setup if that script has been run before.
"""
import argparse
import json
import re
import ssl
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SITE_DIR = SCRIPT_DIR.parent
CREDENTIALS_PATH = SCRIPT_DIR / "espn_credentials.json"
TEAM_MAP_PATH = SCRIPT_DIR / "espn_team_map.json"
MOCK_DRAFT_PATH = SITE_DIR / "pages" / "mock-draft.html"
OUTPUT_PATH = SITE_DIR / "data" / "season_2026" / "draft_grades_2026.json"

DEFAULT_LEAGUE_ID = 39276
API_HOST = "https://lm-api-reads.fantasy.espn.com"

# Standard ESPN NFL pro-team ID -> abbreviation mapping (stable across seasons), needed to
# match a Head Coach pick's encoded team ID against pages/mock-draft.html's coach pool.
PRO_TEAM_ABBREV = {
    1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
    9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
    17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC",
    25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
}

DEFAULT_POSITION_MAP = {1: "QB", 2: "RB", 3: "WR", 4: "TE"}

# Same VBD replacement-rank rule-of-thumb as pages/mock-draft.html:419 (1 starter/team at QB,
# ~2.5/team at RB, ~3/team at WR accounting for shared flex slots, ~1.25/team at TE).
VBD_REPLACEMENT_RANK = {"QB": 12, "RB": 30, "WR": 36, "TE": 15}

# Same round-weighting as pages/mock-draft.html:1338 - late-round bench fliers count less
# toward the grade than early/mid-round picks.
GRADE_ROUND_WEIGHT = {1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1,
                       10: 0.9, 11: 0.75, 12: 0.6, 13: 0.45, 14: 0.3, 15: 0.2}

# Overall team grade: 4-way blend, starter points weighted heaviest per explicit request -
# bench points, ADP value, and upside all still count, but starting-lineup output dominates
# since that's what actually scores.
GRADE_WEIGHTS = {"starter_points": 0.55, "bench_points": 0.15, "value": 0.15, "upside": 0.15}

# Position sub-grades and the bench-only badge use a separate points-dominant 3-way blend
# (unchanged from the original single-signal-set formula) - only the overall team grade above
# was split into the 4-way starter/bench breakdown.
SUBGRADE_WEIGHTS = {"points": 0.80, "value": 0.08, "upside": 0.12}

try:
    import certifi
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    print("ERROR: the 'certifi' package is required (fixes a common macOS SSL certificate issue).")
    print("Run: python3 -m pip install certifi")
    sys.exit(1)


def load_credentials():
    if not CREDENTIALS_PATH.exists():
        print(f"ERROR: {CREDENTIALS_PATH} not found.")
        print("Copy espn_credentials.example.json to espn_credentials.json and fill in your cookies.")
        print("See fetch_espn_week.py's docstring for how to get them.")
        sys.exit(1)
    with open(CREDENTIALS_PATH) as f:
        creds = json.load(f)
    if "paste-your" in creds.get("espn_s2", "") or "paste-your" in creds.get("swid", ""):
        print(f"ERROR: {CREDENTIALS_PATH} still has placeholder values - fill in your real cookies first.")
        sys.exit(1)
    return creds


def load_team_map():
    if not TEAM_MAP_PATH.exists():
        print(f"ERROR: {TEAM_MAP_PATH} not found. Run fetch_espn_week.py --map-teams first.")
        sys.exit(1)
    with open(TEAM_MAP_PATH) as f:
        return json.load(f)


def resolve_manager(team_id, team_map):
    name = team_map.get(str(team_id))
    if not name or name == "FILL_IN_MANAGER_NAME":
        return f"UNMAPPED_TEAM_{team_id}"
    return name


def http_get(url, creds=None, extra_headers=None):
    req = urllib.request.Request(url)
    if creds:
        req.add_header("Cookie", f"espn_s2={creds['espn_s2']}; SWID={creds['swid']}")
    req.add_header("Accept", "application/json")
    for k, v in (extra_headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, context=SSL_CONTEXT, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 401:
            print("ERROR: 401 Unauthorized. Your espn_s2/SWID cookies are missing, wrong, or expired.")
            print("Re-fetch them from your browser (see fetch_espn_week.py's docstring) and try again.")
        else:
            print(f"ERROR: ESPN API returned {e.code} for {url}")
            print(e.read().decode(errors="replace")[:500])
        sys.exit(1)


def fetch_draft_picks(league_id, season, creds):
    path = f"/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{league_id}"
    data = http_get(f"{API_HOST}{path}?view=mDraftDetail", creds=creds)
    detail = data.get("draftDetail", {})
    if not detail.get("drafted"):
        print("ERROR: ESPN reports this league's draft is not complete yet.")
        sys.exit(1)
    picks = detail.get("picks", [])
    print(f"Pulled {len(picks)} draft picks from ESPN (league {league_id}, season {season}).")
    return picks


def fetch_player_pool(season):
    path = f"/apis/v3/games/ffl/seasons/{season}/segments/0/leaguedefaults/3"
    filt = json.dumps({
        "players": {
            "limit": 800,
            "sortDraftRanks": {"sortPriority": 100, "sortAsc": True, "value": "STANDARD"},
            "filterStatsForSourceIds": {"value": [1]},
            "filterStatsForSplitTypeIds": {"value": [0]},
        }
    })
    data = http_get(f"{API_HOST}{path}?view=kona_player_info", extra_headers={"x-fantasy-filter": filt})
    pool = {}
    for entry in data.get("players", []):
        p = entry.get("player", {})
        pid = p.get("id")
        pos = DEFAULT_POSITION_MAP.get(p.get("defaultPositionId"))
        if pid is None or pos is None:
            continue  # K/D-ST/etc - not used in this league's roster format
        pts = 0.0
        for stat in p.get("stats", []):
            if stat.get("seasonId") == season and stat.get("statSourceId") == 1 and stat.get("statSplitTypeId") == 0:
                pts = stat.get("appliedTotal", 0.0)
                break
        adp = p.get("ownership", {}).get("averageDraftPosition") or 999.0
        dr = p.get("draftRanksByRankType", {}).get("STANDARD", {}).get("rank") or adp
        pool[pid] = {
            "name": p.get("fullName", f"Player {pid}"),
            "pos": pos,
            "nfl_team": PRO_TEAM_ABBREV.get(p.get("proTeamId"), ""),
            "pts": round(pts, 1),
            "adp": adp,
            "dr": dr,
        }
    print(f"Pulled {len(pool)} skill-position players' projections/ADP from ESPN.")
    return pool


def load_coach_pool():
    """Head coaches aren't in kona_player_info - reuse the projected-wins-based coach pool
    already embedded in pages/mock-draft.html (see that file's own HANDOFF for sourcing)."""
    if not MOCK_DRAFT_PATH.exists():
        print(f"WARNING: {MOCK_DRAFT_PATH} not found - Head Coach picks will have no projection data.")
        return {}
    text = MOCK_DRAFT_PATH.read_text()
    m = re.search(r'<script id="draftData" type="application/json">(.*?)</script>', text, re.S)
    if not m:
        print("WARNING: could not find embedded draft data in mock-draft.html - Head Coach picks will have no projection data.")
        return {}
    data = json.loads(m.group(1))
    return {c["t"]: c for c in data.get("coaches", []) if c.get("t")}


def resolve_pick_player(pick, player_pool, coach_pool):
    pid = pick["playerId"]
    if pid in player_pool:
        return dict(player_pool[pid])
    if pid < 0:
        pro_team_id = -pid - 14000
        abbrev = PRO_TEAM_ABBREV.get(pro_team_id, "")
        coach = coach_pool.get(abbrev)
        if coach:
            return {"name": coach["n"], "pos": "HC", "nfl_team": abbrev,
                     "pts": coach.get("pts", 0.0), "adp": coach.get("adp", 999.0), "dr": coach.get("adp", 999.0)}
        return {"name": f"{abbrev or 'Unknown'} Head Coach", "pos": "HC", "nfl_team": abbrev,
                 "pts": 0.0, "adp": 999.0, "dr": 999.0}
    return {"name": f"Unmatched Player {pid}", "pos": "UNK", "nfl_team": "",
             "pts": 0.0, "adp": 999.0, "dr": 999.0}


def assign_optimal_lineup(records):
    """Assigns each of a manager's drafted players (records, mutated in place) to the best
    possible starting lineup - 1 QB, 2 RB, 2 WR, 1 TE, 1 TE/WR flex ("W/T"), 1 FLEX (RB/WR/TE),
    1 HC - by projected points, not by the order they were drafted in. QB and HC have no
    competition for their single dedicated slot, so the best of each starts outright. RB/WR/TE
    share a nested set of slots (WR/TE can also fill W/T; RB/WR/TE can also fill FLEX), so those
    are processed together in points-descending order, each player taking the most specific
    (least flexible) slot still open to it - the standard greedy for this kind of nested/laminar
    flex-slot structure, and optimal for it (an exchange argument: since eligibility is nested,
    any swap that "frees up" a specific slot for a higher-value player can only ever move a
    lower-value player into a broader slot, never lose total value).
    Everyone not assigned a starting slot is bench."""
    for r in records:
        r["slot"] = "BEN"
        r["is_starter"] = False

    qbs = sorted((r for r in records if r["position"] == "QB"), key=lambda r: -r["projected_pts"])
    if qbs:
        qbs[0]["slot"], qbs[0]["is_starter"] = "QB", True

    hcs = sorted((r for r in records if r["position"] == "HC"), key=lambda r: -r["projected_pts"])
    if hcs:
        hcs[0]["slot"], hcs[0]["is_starter"] = "HC", True

    flex_pool = sorted((r for r in records if r["position"] in ("RB", "WR", "TE")),
                        key=lambda r: -r["projected_pts"])
    remaining = {"RB": 2, "WR": 2, "TE": 1, "WT": 1, "FLEX": 1}
    for r in flex_pool:
        pos = r["position"]
        if pos == "RB":
            if remaining["RB"] > 0:
                r["slot"] = "RB1" if remaining["RB"] == 2 else "RB2"
                remaining["RB"] -= 1
            elif remaining["FLEX"] > 0:
                r["slot"] = "FLEX"
                remaining["FLEX"] -= 1
            else:
                continue
        elif pos == "WR":
            if remaining["WR"] > 0:
                r["slot"] = "WR1" if remaining["WR"] == 2 else "WR2"
                remaining["WR"] -= 1
            elif remaining["WT"] > 0:
                r["slot"] = "W/T"
                remaining["WT"] -= 1
            elif remaining["FLEX"] > 0:
                r["slot"] = "FLEX"
                remaining["FLEX"] -= 1
            else:
                continue
        elif pos == "TE":
            if remaining["TE"] > 0:
                r["slot"] = "TE"
                remaining["TE"] -= 1
            elif remaining["WT"] > 0:
                r["slot"] = "W/T"
                remaining["WT"] -= 1
            elif remaining["FLEX"] > 0:
                r["slot"] = "FLEX"
                remaining["FLEX"] -= 1
            else:
                continue
        r["is_starter"] = True


def compute_vbd_baseline(player_pool):
    baseline = {}
    for pos, rank in VBD_REPLACEMENT_RANK.items():
        by_pts = sorted((p["pts"] for p in player_pool.values() if p["pos"] == pos), reverse=True)
        baseline[pos] = by_pts[min(rank, len(by_pts) - 1)] if by_pts else 0.0
    return baseline


def upside_score(player, vbd_baseline):
    return player["pts"] - vbd_baseline.get(player["pos"], 0.0)


def gradeLetter(pct):
    if pct >= 0.94: return "A+"
    if pct >= 0.86: return "A"
    if pct >= 0.78: return "A-"
    if pct >= 0.70: return "B+"
    if pct >= 0.62: return "B"
    if pct >= 0.54: return "B-"
    if pct >= 0.46: return "C+"
    if pct >= 0.38: return "C"
    if pct >= 0.30: return "C-"
    if pct >= 0.22: return "D+"
    if pct >= 0.14: return "D"
    if pct >= 0.06: return "D-"
    return "F"


def percentile_ranks(values_by_key):
    """values_by_key: {key: value}, higher = better. Returns {key: percentile 0..1, 1=best}."""
    keys = list(values_by_key.keys())
    n = len(keys)
    if n <= 1:
        return {k: 1.0 for k in keys}
    ranked = sorted(keys, key=lambda k: values_by_key[k], reverse=True)
    return {k: 1 - ranked.index(k) / (n - 1) for k in keys}


def blended_grade(components, weights):
    """components: {signal_name: {manager: raw value}}, higher raw value = better.
    weights: {signal_name: weight}, must match components' keys and sum to 1.
    Returns {manager: {percentile, grade, ranks: {signal_name: rank}}}."""
    pct_by_signal = {name: percentile_ranks(vals) for name, vals in components.items()}
    managers = next(iter(components.values())).keys()
    out = {}
    for mgr in managers:
        pct = sum(weights[name] * pct_by_signal[name][mgr] for name in components)
        out[mgr] = {
            "percentile": round(pct, 4),
            "grade": gradeLetter(pct),
            "ranks": {name: ranked_position(pct_by_signal[name], mgr) for name in components},
        }
    return out


def ranked_position(pct_dict, key):
    ordered = sorted(pct_dict.keys(), key=lambda k: pct_dict[k], reverse=True)
    return ordered.index(key) + 1


def build_grades(picks, player_pool, coach_pool, team_map):
    vbd_baseline = compute_vbd_baseline(player_pool)

    all_picks_by_manager = {}  # manager -> list of pick records
    for pick in sorted(picks, key=lambda p: p["overallPickNumber"]):
        manager = resolve_manager(pick["teamId"], team_map)
        player = resolve_pick_player(pick, player_pool, coach_pool)
        reach = pick["overallPickNumber"] - player["adp"]
        vbd = upside_score(player, vbd_baseline)
        record = {
            "round": pick["roundId"],
            "pick": pick["overallPickNumber"],
            "round_pick": pick["roundPickNumber"],
            "player": player["name"],
            "position": player["pos"],
            "nfl_team": player["nfl_team"],
            "projected_pts": player["pts"],
            "adp": round(player["adp"], 1) if player["adp"] < 999 else None,
            "value": round(reach, 1),
            "vbd": round(vbd, 1),
            "keeper": pick.get("keeper", False),
        }
        all_picks_by_manager.setdefault(manager, []).append(record)

    # Assigns each manager's full draft class to the best possible starting lineup by
    # projected points (see assign_optimal_lineup) - sets "slot"/"is_starter" on every record.
    for recs in all_picks_by_manager.values():
        assign_optimal_lineup(recs)

    # ---- Overall team grades: starter pts (heaviest), bench pts, ADP value, upside ----
    starter_pts, bench_pts, avg_value, avg_upside = {}, {}, {}, {}
    for mgr, recs in all_picks_by_manager.items():
        starter_pts[mgr] = sum(r["projected_pts"] for r in recs if r["is_starter"])
        bench_pts[mgr] = sum(r["projected_pts"] for r in recs if not r["is_starter"])

        total_reach_w, total_upside_w, total_w = 0.0, 0.0, 0.0
        for r in recs:
            w = GRADE_ROUND_WEIGHT.get(r["round"], 1)
            total_reach_w += r["value"] * w
            total_upside_w += r["vbd"] * w
            total_w += w
        avg_value[mgr] = total_reach_w / total_w if total_w else 0.0
        avg_upside[mgr] = total_upside_w / total_w if total_w else 0.0

    overall = blended_grade(
        {"starter_points": starter_pts, "bench_points": bench_pts, "value": avg_value, "upside": avg_upside},
        GRADE_WEIGHTS,
    )

    # ---- Position sub-grades (starters only - a position's grade reflects what's actually in
    # the lineup, e.g. a bench-buried 4th WR doesn't help or hurt the WR grade; bench-only
    # players are graded separately below, in the bench grade, regardless of their position) ----
    positions = ["QB", "RB", "WR", "TE", "HC"]
    position_grades = {mgr: {} for mgr in all_picks_by_manager}
    for pos in positions:
        pos_pts, pos_value, pos_upside = {}, {}, {}
        for mgr, recs in all_picks_by_manager.items():
            pos_recs = [r for r in recs if r["position"] == pos and r["is_starter"]]
            pos_pts[mgr] = sum(r["projected_pts"] for r in pos_recs)
            pos_value[mgr] = sum(r["value"] for r in pos_recs) / len(pos_recs) if pos_recs else 0.0
            pos_upside[mgr] = sum(r["vbd"] for r in pos_recs) / len(pos_recs) if pos_recs else 0.0
        graded = blended_grade({"points": pos_pts, "value": pos_value, "upside": pos_upside}, SUBGRADE_WEIGHTS)
        for mgr, recs in all_picks_by_manager.items():
            position_grades[mgr][pos] = {
                "grade": graded[mgr]["grade"],
                "percentile": graded[mgr]["percentile"],
                "total_projected_pts": round(pos_pts[mgr], 1),
                "picks": len([r for r in recs if r["position"] == pos and r["is_starter"]]),
            }

    # ---- Bench-only grade badge (points/value/upside scoped to bench-slotted picks) ----
    bench_value, bench_upside = {}, {}
    for mgr, recs in all_picks_by_manager.items():
        bench_recs = [r for r in recs if not r["is_starter"]]
        bench_value[mgr] = sum(r["value"] for r in bench_recs) / len(bench_recs) if bench_recs else 0.0
        bench_upside[mgr] = sum(r["vbd"] for r in bench_recs) / len(bench_recs) if bench_recs else 0.0
    bench_graded = blended_grade({"points": bench_pts, "value": bench_value, "upside": bench_upside}, SUBGRADE_WEIGHTS)

    managers_out = []
    for mgr in sorted(all_picks_by_manager, key=lambda m: overall[m]["percentile"], reverse=True):
        managers_out.append({
            "manager": mgr,
            "overall_grade": overall[mgr]["grade"],
            "overall_percentile": overall[mgr]["percentile"],
            "ranks": overall[mgr]["ranks"],
            "starter_projected_pts": round(starter_pts[mgr], 1),
            "bench_projected_pts": round(bench_pts[mgr], 1),
            "avg_adp_value": round(avg_value[mgr], 1),
            "avg_upside": round(avg_upside[mgr], 1),
            "position_grades": position_grades[mgr],
            "bench_grade": {
                "grade": bench_graded[mgr]["grade"],
                "percentile": bench_graded[mgr]["percentile"],
                "total_projected_pts": round(bench_pts[mgr], 1),
            },
            "picks": sorted(all_picks_by_manager[mgr], key=lambda r: r["pick"]),
        })
    return managers_out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--league-id", type=int, default=DEFAULT_LEAGUE_ID)
    parser.add_argument("--season", type=int, default=datetime.now().year)
    args = parser.parse_args()

    creds = load_credentials()
    team_map = load_team_map()

    picks = fetch_draft_picks(args.league_id, args.season, creds)
    player_pool = fetch_player_pool(args.season)
    coach_pool = load_coach_pool()

    unmatched = [p["playerId"] for p in picks if p["playerId"] >= 0 and p["playerId"] not in player_pool]
    if unmatched:
        print(f"WARNING: {len(unmatched)} drafted player IDs had no ESPN projection match: {unmatched}")

    managers_out = build_grades(picks, player_pool, coach_pool, team_map)

    output = {
        "season": args.season,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "methodology": {
            "grade_weights": GRADE_WEIGHTS,
            "note": ("Grades are based on 2026 preseason projections and ADP, not actual season "
                     "results (the season hasn't happened yet). Starters/bench reflect each "
                     "manager's best possible lineup (highest-projected players by slot "
                     "eligibility - 1 QB, 2 RB, 2 WR, 1 TE, 1 TE/WR flex, 1 FLEX, 1 HC), not "
                     "ESPN's live roster or draft order. Overall grade = percentile blend of "
                     f"starting-lineup points ({round(GRADE_WEIGHTS['starter_points']*100)}%, "
                     "the heaviest signal), bench points "
                     f"({round(GRADE_WEIGHTS['bench_points']*100)}%), ADP-reach value "
                     f"({round(GRADE_WEIGHTS['value']*100)}%), and VBD upside "
                     f"({round(GRADE_WEIGHTS['upside']*100)}%)."),
        },
        "managers": managers_out,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)
    print(f"Wrote {len(managers_out)} manager grades -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
