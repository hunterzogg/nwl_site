#!/usr/bin/env python3
"""
Builds data/player_weeks.json: every NWL roster's players for every week of every season ESPN gives
this account full box scores for, with each player's NWL-scored points and lineup slot. Powers the
retro trade grader (pages/transactions.html, Trade Grades tab), the year-end awards page and the
player side of "This week in NWL history".

Source: ESPN box scores, seasons/<year>/segments/0/leagues/39276?view=mMatchup&view=mMatchupScore
&scoringPeriodId=<week>. Each matchup's home/away.rosterForCurrentScoringPeriod.entries carries the
player, his lineupSlotId and playerPoolEntry.appliedStatTotal (NWL scoring) for that week.

Access: this account (scripts/espn_credentials.json) only has full detail for 2022 onward. 2018-2021
return 401 (the account wasn't a league member those seasons) and 2013-2017 return 404 (archived).
That's ESPN enforcing membership, and we don't try to get around it. If cookies from an account that
WAS a member in those seasons are saved to scripts/espn_credentials_legacy.json (same shape, gitignored),
2018-2021 are tried with them too.

Team ids are mapped to managers per season by matching week 1-3 scores to data/weekly_scores.json
(team ids changed hands over the years; 2026 uses scripts/espn_team_map.json instead).

Output (compact):
  { "updated_at", "players": {espnId: [name, pos]},
    "seasons": { "2024": { "weeks": { "1": [[manager, espnId, slot, points], ...], ... } } } }
  slot: "S" starter (incl. HC), "B" bench, "IR"

Usage: python3 scripts/build_history_points.py [--seasons 2022 2023 ...]
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import build_trade_values as btv  # noqa: E402  (shared get() with the curl fallback)

SITE = SCRIPT_DIR.parent
OUT = SITE / "data" / "player_weeks.json"
LEGACY = SCRIPT_DIR / "espn_credentials_legacy.json"
API = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{y}/segments/0/leagues/39276"
POS = {1: "QB", 2: "RB", 3: "WR", 4: "TE"}
LAST_WEEK = 17


def cookies(path):
    c = json.loads(path.read_text())
    return f"espn_s2={c['espn_s2']}; SWID={c['swid']}"


def fetch(year, week, ck):
    return btv.get(API.format(y=year) + f"?view=mMatchup&view=mMatchupScore&scoringPeriodId={week}", {"Cookie": ck})


def team_map(year, ck, weekly):
    """ESPN team id -> manager, by matching each team's week 1-3 scores to weekly_scores.json."""
    sch = btv.get(API.format(y=year) + "?view=mMatchupScore", {"Cookie": ck})["schedule"]
    ws = [r for r in weekly if r["season"] == str(year)]
    votes = {}
    for m in sch:
        wk = m.get("matchupPeriodId")
        if wk not in (1, 2, 3):
            continue
        for side in ("home", "away"):
            if side not in m:
                continue
            sc = m[side]["totalPoints"]
            hits = [r["manager"] for r in ws if r["week"] == str(wk) and abs(float(r["score"]) - sc) < 0.6]
            if len(hits) == 1:
                votes.setdefault(m[side]["teamId"], {}).setdefault(hits[0], 0)
                votes[m[side]["teamId"]][hits[0]] += 1
    return {tid: max(v, key=v.get) for tid, v in votes.items()}


def pos_of(pl, slot):
    if pl.get("id", 0) < 0 or slot == 19:
        return "HC"
    return POS.get(pl.get("defaultPositionId"))


def slot_code(slot):
    return "B" if slot == 20 else "IR" if slot == 21 else "S"


def build_season(year, ck, weekly, players):
    tm = team_map(year, ck, weekly)
    weeks = {}
    for wk in range(1, LAST_WEEK + 1):
        d = fetch(year, wk, ck)
        rows = []
        for m in d.get("schedule", []):
            if m.get("matchupPeriodId") != wk:
                continue
            for side in ("home", "away"):
                if side not in m:
                    continue
                mgr = tm.get(m[side]["teamId"])
                for e in (m[side].get("rosterForCurrentScoringPeriod") or {}).get("entries", []):
                    pl = e["playerPoolEntry"]["player"]
                    pos = pos_of(pl, e["lineupSlotId"])
                    if not pos or not mgr:
                        continue
                    pid = str(pl["id"])
                    players[pid] = [pl.get("fullName"), pos]
                    rows.append([mgr, pid, slot_code(e["lineupSlotId"]), round(e["playerPoolEntry"].get("appliedStatTotal") or 0, 2)])
        if rows:
            weeks[str(wk)] = rows
        print(f"  {year} week {wk}: {len(rows)} roster rows")
    return {"team_map": {str(k): v for k, v in tm.items()}, "weeks": weeks}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", nargs="*", type=int, default=list(range(2022, 2026)))
    args = ap.parse_args()
    weekly = json.loads((SITE / "data" / "weekly_scores.json").read_text())
    out = json.loads(OUT.read_text()) if OUT.exists() else {"players": {}, "seasons": {}}
    main_ck = cookies(SCRIPT_DIR / "espn_credentials.json")
    tries = [(y, main_ck) for y in args.seasons]
    if LEGACY.exists():
        legacy = cookies(LEGACY)
        tries += [(y, legacy) for y in range(2018, 2022) if y not in args.seasons]
    for year, ck in tries:
        try:
            print(f"Season {year}...")
            out["seasons"][str(year)] = build_season(year, ck, weekly, out["players"])
        except Exception as e:  # noqa: BLE001 - 401/404 = no access to that season; keep going
            print(f"  skipped {year}: {getattr(e, 'code', e)}")
    out["updated_at"] = datetime.now(timezone.utc).isoformat()
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    n = sum(len(r) for s in out["seasons"].values() for r in s["weeks"].values())
    print(f"Wrote {OUT} - {len(out['seasons'])} seasons, {n} roster rows, {len(out['players'])} players")


if __name__ == "__main__":
    main()
