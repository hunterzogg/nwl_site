#!/usr/bin/env python3
"""
Builds data/trade_grades.json: a retro grade for every trade in data/trades.json that ESPN box
scores cover (2022 on; see build_history_points.py for why earlier seasons aren't available).

For each side, every player it received is followed for the rest of that season, from the first NWL
week after the trade, for as long as the receiving team kept him (weeks after a drop or a re-trade
don't count). Each week he scores:
  points over replacement = max(0, his NWL points - replacement level at his position that week)
Replacement level = the average of the players ranked just past the league's starters at that
position that week among everyone on an NWL roster (QB/TE/HC: 13th-18th, RB/WR: 31st-36th).
Fantasy playoff weeks (15-17) count 1.5x because they decide titles. Started points (what the
receiving team actually put in its lineup) are reported alongside but don't change the grade.
FAAB dollars and draft picks are listed, not graded.

Side value = sum over its players; net = this side minus the other. Grades are symmetric on net
points over replacement: A+ >= 80, A >= 50, A- >= 30, B+ >= 15, B within 15 of even, C down to -40,
D down to -80, F beyond.

Usage: python3 scripts/build_trade_grades.py   (after build_history_points.py)
"""
import json
import re
from datetime import date
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
OUT = SITE / "data" / "trade_grades.json"
# Thursday kickoff of NFL week 1 (NWL week N = NFL week N)
KICKOFF = {2018: date(2018, 9, 6), 2019: date(2019, 9, 5), 2020: date(2020, 9, 10), 2021: date(2021, 9, 9),
           2022: date(2022, 9, 8), 2023: date(2023, 9, 7), 2024: date(2024, 9, 5), 2025: date(2025, 9, 4), 2026: date(2026, 9, 10)}
LAST_WEEK, PLAYOFF_FROM, PLAYOFF_WEIGHT = 17, 15, 1.5
CURRENT_SEASON = 2026
REPL_RANKS = {"QB": (13, 18), "TE": (13, 18), "HC": (13, 18), "RB": (31, 36), "WR": (31, 36)}
# calibrated on 2022-2025 (median |net| about 31, 90th percentile about 89): B is within 15 of even, F is losing by 80+
GRADES = [(80, "A+"), (50, "A"), (30, "A−"), (15, "B+"), (-15, "B"), (-40, "C"), (-80, "D")]
# trades.json spellings that differ from ESPN's (kept as-is in the source data)
ALIASES = {"isaiahpacheco": "isiahpacheco", "breshardsmith": "brashardsmith", "lions": "lionscoach"}
POS_FIX = {"marcusmariota": "QB"}


def norm(n):
    n = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", (n or "").lower())
    n = re.sub(r"[^a-z]", "", n)
    return ALIASES.get(n, n)


def grade(net):
    for cut, g in GRADES:
        if net >= cut:
            return g
    return "F"


def eff_week(season, d):
    """The NWL week a trade on date d first counts toward: NFL weeks run Tuesday to Monday, and ESPN's
    box score for a week shows the roster as it stood for that week's games (checked against the
    rosters: trades on a Friday already show up in that same week). Used only when the rosters
    don't show the move directly."""
    k = KICKOFF[season]
    tuesday = k.toordinal() - 2
    return max(1, min(LAST_WEEK + 1, (d.toordinal() - tuesday) // 7 + 1))


def observed_week(weeks, pid_sides, a, b):
    """The week the traded players actually changed hands between a and b, from the weekly rosters
    (median over players), plus how many moved the recorded way vs. the opposite way."""
    own = {}
    for w, rows in weeks.items():
        for r in rows:
            own.setdefault(r[1], {})[w] = r[0]
    moves, fwd, rev = [], 0, 0
    for pid, me in pid_sides:
        o = own.get(pid, {})
        for w in range(2, LAST_WEEK + 1):
            if {o.get(w - 1), o.get(w)} == {a, b}:
                moves.append(w)
                if o.get(w) == me:
                    fwd += 1
                else:
                    rev += 1
                break
    moves.sort()
    return (moves[len(moves) // 2] if moves else None), fwd, rev


def main():
    pw = json.loads((SITE / "data" / "player_weeks.json").read_text())
    trades = json.loads((SITE / "data" / "trades.json").read_text())
    names = {}
    for pid, (n, pos) in pw["players"].items():
        names.setdefault(norm(n), []).append((pid, pos))
        if pos == "HC":  # "49ers Coach" also answers to "49ers"
            names.setdefault(norm(n.replace(" Coach", "")), []).append((pid, pos))

    out_trades, unmatched = [], []
    for i, t in enumerate(trades):
        season = int(t["season"])
        S = pw["seasons"].get(str(season))
        if not S or not re.match(r"^\d{4}-\d\d-\d\d$", t["date"]):
            continue
        weeks = {int(w): rows for w, rows in S["weeks"].items()}
        # replacement level per position per week, from everyone rostered that week
        repl = {}
        for w, rows in weeks.items():
            by = {}
            for mgr, pid, slot, pts in rows:
                by.setdefault(pw["players"][pid][1], []).append(pts)
            repl[w] = {}
            for pos, (a, b) in REPL_RANKS.items():
                xs = sorted(by.get(pos, []), reverse=True)[a - 1:b]
                repl[w][pos] = sum(xs) / len(xs) if xs else 0
        start = eff_week(season, date.fromisoformat(t["date"]))
        # first pass: match names to ESPN ids, then confirm the week (and direction) from the rosters
        matched = {}
        for me, other, key in ((t["team1"], t["team2"], "team1_received"), (t["team2"], t["team1"], "team2_received")):
            for it in [x.strip() for x in t[key].split(";") if " - " in x]:
                pos, name = it.split(" - ", 1)
                pos = POS_FIX.get(norm(name), pos)
                cands = [c for c in names.get(norm(name), []) if c[1] == pos] or names.get(norm(name), [])
                ids = {c[0] for c in cands}
                on_other = [c for c in cands if any(r[1] == c[0] and r[0] == other for w in range(max(1, start - 2), start + 2) for r in weeks.get(w, []))]
                matched[(me, it)] = (on_other or cands or [None])[0]
        obs, fwd, rev = observed_week(weeks, [(c[0], me) for (me, it), c in matched.items() if c], t["team1"], t["team2"])
        if rev > fwd:
            print(f"  WARNING trade {i} ({season} {t['team1']}/{t['team2']}): {rev} players moved opposite to trades.json, {fwd} as recorded - check the data")
        if obs and abs(obs - start) <= 2:
            start = obs
        sides = []
        for me, other, key in ((t["team1"], t["team2"], "team1_received"), (t["team2"], t["team1"], "team2_received")):
            players, extras = [], []
            for it in [x.strip() for x in t[key].split(";") if x.strip()]:
                if " - " not in it:
                    extras.append(it)
                    continue
                pos, name = it.split(" - ", 1)
                pos = POS_FIX.get(norm(name), pos)
                c = matched.get((me, it))
                if not c:
                    unmatched.append(f"{season} {pos} {name}")
                    players.append({"name": name, "pos": pos, "matched": False, "weeks": 0, "pts": 0, "started": 0, "por": 0, "weekly": []})
                    continue
                pid = c[0]
                weekly, held, pts_sum, st_sum, por = [], 0, 0.0, 0.0, 0.0
                for w in range(start, LAST_WEEK + 1):
                    row = next((r for r in weeks.get(w, []) if r[1] == pid), None)
                    if not row or row[0] != me:
                        if row and row[0] != me and held:
                            break  # moved on (re-traded or dropped and claimed): stop following him
                        continue
                    held += 1
                    mult = PLAYOFF_WEIGHT if w >= PLAYOFF_FROM else 1
                    p = row[3]
                    pts_sum += p
                    if row[2] == "S":
                        st_sum += p
                    por += mult * max(0.0, p - repl[w].get(pos, 0))
                    weekly.append([w, round(p, 1), row[2]])
                players.append({"name": pw["players"][pid][0], "pid": pid, "pos": pos, "matched": True, "weeks": held,
                                "pts": round(pts_sum, 1), "started": round(st_sum, 1), "por": round(por, 1), "weekly": weekly})
            sides.append({"manager": me, "players": players, "extras": extras, "value": round(sum(p["por"] for p in players), 1),
                          "pts": round(sum(p["pts"] for p in players), 1), "started": round(sum(p["started"] for p in players), 1)})
        net = sides[0]["value"] - sides[1]["value"]
        sides[0]["net"], sides[1]["net"] = round(net, 1), round(-net, 1)
        sides[0]["grade"], sides[1]["grade"] = grade(net), grade(-net)
        last_final = max(weeks) if weeks else 0
        weeks_counted = max(0, min(LAST_WEEK, last_final) - start + 1)
        graded_players = sum(1 for sd in sides for p in sd["players"])
        out_trades.append({"id": i, "season": season, "date": t["date"], "precision": t["precision"], "start_week": start,
                           # the current season is graded on the weeks played so far; picks-only trades aren't graded
                           "in_progress": season >= CURRENT_SEASON, "weeks_counted": weeks_counted,
                           "gradable": graded_players > 0 and weeks_counted > 0, "picks_used_on": t.get("picks_used_on"),
                           "sides": sides, "winner": None if abs(net) < 15 else sides[0 if net > 0 else 1]["manager"]})
    OUT.write_text(json.dumps({"trades": out_trades, "method": {"replacement_ranks": REPL_RANKS, "playoff_weight": PLAYOFF_WEIGHT,
                                                                "grades": GRADES}}, separators=(",", ":"), ensure_ascii=False))
    print(f"Wrote {OUT} - {len(out_trades)} trades graded; unmatched players: {unmatched or 'none'}")


if __name__ == "__main__":
    main()
