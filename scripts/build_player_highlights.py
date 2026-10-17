#!/usr/bin/env python3
"""
Builds data/player_week_highlights.json: the biggest single-game player performances of every NFL
week since 2013, for "This week in NWL history" (homepage card + 2026 Hub strip).

Source: nflverse weekly player stats (the same CSVs build_draft_grades.py uses, cached in
scripts/.cache/stats_player_week_<season>.csv). Regular season only, QB/RB/WR/TE, weeks 1-17
(NFL week N = NWL week N). Half-PPR = standard fantasy points + 0.5 x receptions.

Per season and week it keeps the top 5 games plus the best game at each position. Each row says
whose NWL team the player was on:
  - 2022+: from data/player_weeks.json (ESPN box scores): the manager, whether he was started, and
    his real NWL points that week
  - 2013-2021: weekly NWL rosters aren't available, so who drafted him that season (draft_picks.json)
pos_alltime_top10 marks a top-10 half-PPR game ever at that position (2013 on).

Usage: python3 scripts/build_player_highlights.py   (rerun after each season)
"""
import csv
import io
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from build_draft_grades import fetch_csv, normalize_name  # noqa: E402

SITE = SCRIPT_DIR.parent
OUT = SITE / "data" / "player_week_highlights.json"
SEASONS = range(2013, 2026)
POSITIONS = ("QB", "RB", "WR", "TE")
TOP_N = 5


def num(r, k):
    try:
        return float(r.get(k) or 0)
    except ValueError:
        return 0.0


def stat_line(r, pos):
    py, ptd, ints = num(r, "passing_yards"), num(r, "passing_tds"), num(r, "passing_interceptions") or num(r, "interceptions")
    ry, rtd = num(r, "rushing_yards"), num(r, "rushing_tds")
    rec, wy, wtd = num(r, "receptions"), num(r, "receiving_yards"), num(r, "receiving_tds")
    bits = []
    if pos == "QB":
        bits.append(f"{py:.0f} pass yds, {ptd:.0f} TD" + (f", {ints:.0f} INT" if ints else ""))
        if ry >= 30 or rtd:
            bits.append(f"{ry:.0f} rush yds" + (f", {rtd:.0f} rush TD" if rtd else ""))
    else:
        if ry >= 20 or rtd:
            bits.append(f"{ry:.0f} rush yds" + (f", {rtd:.0f} TD" if rtd else ""))
        if rec or wy:
            bits.append(f"{rec:.0f} rec, {wy:.0f} yds" + (f", {wtd:.0f} TD" if wtd else ""))
    return " · ".join(bits)


def main():
    pw = json.loads((SITE / "data" / "player_weeks.json").read_text()) if (SITE / "data" / "player_weeks.json").exists() else {"players": {}, "seasons": {}}
    picks = json.loads((SITE / "data" / "draft_picks.json").read_text())
    drafted = {(p["season"], normalize_name(p["player"])): p["manager"] for p in picks}
    # NWL roster lookup for 2022+: (season, week, normalized name, pos) -> (manager, slot, points)
    roster = {}
    for season, s in pw["seasons"].items():
        for wk, rows in s["weeks"].items():
            for mgr, pid, slot, pts in rows:
                name, pos = pw["players"].get(pid, [None, None])
                if name:
                    roster[(season, int(wk), normalize_name(name), pos)] = (mgr, slot, pts)

    games = []
    for season in SEASONS:
        rows = csv.DictReader(io.StringIO(fetch_csv(season)))
        for r in rows:
            pos = r.get("position")
            if r.get("season_type") != "REG" or pos not in POSITIONS:
                continue
            wk = int(r["week"])
            if wk > 17:
                continue
            half = num(r, "fantasy_points") + 0.5 * num(r, "receptions")
            if half < 15:
                continue
            games.append({"season": season, "week": wk, "player": r["player_display_name"], "pos": pos,
                          "team": r.get("team"), "opp": r.get("opponent_team"), "pts": round(half, 1),
                          "line": stat_line(r, pos)})

    # all-time top 10 per position
    top10 = set()
    for pos in POSITIONS:
        for g in sorted((g for g in games if g["pos"] == pos), key=lambda g: -g["pts"])[:10]:
            top10.add(id(g))

    out = []
    by_week = {}
    for g in games:
        by_week.setdefault((g["season"], g["week"]), []).append(g)
    for (season, wk), gs in sorted(by_week.items()):
        gs.sort(key=lambda g: -g["pts"])
        keep = gs[:TOP_N]
        for pos in POSITIONS:
            best = next((g for g in gs if g["pos"] == pos), None)
            if best and best not in keep:
                keep.append(best)
        for g in keep:
            row = dict(g)
            if id(g) in top10:
                row["pos_alltime_top10"] = True
            key = (str(season), wk, normalize_name(g["player"]), g["pos"])
            if key in roster:
                mgr, slot, pts = roster[key]
                row["nwl"] = {"manager": mgr, "started": slot == "S", "points": pts}
            elif season >= 2022 and str(season) in pw["seasons"]:
                row["nwl"] = {"free_agent": True}
            elif (str(season), normalize_name(g["player"])) in drafted:
                row["nwl"] = {"drafted_by": drafted[(str(season), normalize_name(g["player"]))]}
            out.append(row)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {OUT} - {len(out)} highlight games from {len(by_week)} season-weeks "
          f"({sum(1 for r in out if r.get('pos_alltime_top10'))} all-time top-10 games, "
          f"{sum(1 for r in out if 'manager' in r.get('nwl', {}))} with an NWL owner from ESPN)")


if __name__ == "__main__":
    main()
