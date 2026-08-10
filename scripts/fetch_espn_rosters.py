#!/usr/bin/env python3
"""
Pulls every manager's CURRENT roster from ESPN and computes a rest-of-season trade value for
each player, for pages/trade-tools.html's Trade Finder and Trade Calculator.

Unlike fetch_espn_draft.py (a one-time pull of the completed draft), rosters change all season
via waivers/trades - re-run this any time you want fresher trade values. It's cheap and safe to
re-run, same as fetch_espn_week.py.

Data pulled:
  1. mRoster + mSettings (authenticated, same espn_credentials.json as the other scripts) - every
     team's current 15(ish)-man roster, plus the league's matchup schedule length and current
     scoring period, used to compute weeks_remaining (see below). Each rostered player carries
     ESPN's own season-long projected points AND points already scored this season (see
     ros_value below).
  2. kona_player_info (public, no auth needed - same endpoint fetch_espn_draft.py uses for its
     VBD baseline) - a wide ~800-player pool. Used for two things: (a) a realistic
     replacement-level baseline per position (using the wide pool instead of just our 180
     rostered players avoids a circular baseline - bench players defining "replacement level"
     for themselves), and (b) the free-agent pool - whichever of those ~800 players ISN'T on any
     of the 12 rosters, so the site can suggest a specific waiver pickup when a trade would leave
     a team with zero players at a position.
  3. data/season_2026/standings.json (already on disk, no extra API call) - for each manager's
     division, shown alongside their roster.

Value methodology (deliberately reuses fetch_espn_draft.py's VBD approach, not a new metric -
see that script for the original methodology and comments):
  - ros_value (rest-of-season value) = max(season-long projected total - points already scored
    this season, 0). This is a trade tool, not a preseason-projection tool, so what matters is
    what's LEFT to play, not the whole season including points already banked.
  - vbd_value = ros_value - vbd_baseline[position], where vbd_baseline uses the same
    VBD_REPLACEMENT_RANK convention as fetch_espn_draft.py (points-over-replacement, the site's
    established "value" signal). Head Coach gets vbd_value: null - there's no comparable
    32-coach replacement pool to score it against on the same scale as skill positions, so HC is
    shown in roster views but excluded from all trade math in trade-tools.html.
  - slot/is_starter are precomputed here via assign_optimal_lineup (copied from
    fetch_espn_draft.py, fed ros_value instead of preseason projected_pts - same "best possible
    lineup by value" concept, just a different value metric behind it). trade-tools.html re-runs
    this client-side too, since a hypothetical trade being built changes a roster's optimal
    lineup live.

Setup: identical to fetch_espn_week.py - needs scripts/espn_credentials.json in place.
"""
import argparse
import json
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
STANDINGS_PATH = SITE_DIR / "data" / "season_2026" / "standings.json"
OUTPUT_PATH = SITE_DIR / "data" / "season_2026" / "rosters.json"

DEFAULT_LEAGUE_ID = 39276
API_HOST = "https://lm-api-reads.fantasy.espn.com"

DEFAULT_POSITION_MAP = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 14: "HC"}
PRO_TEAM_ABBREV = {
    1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
    9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
    17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC",
    25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
}

# Same VBD replacement-rank convention as fetch_espn_draft.py - see that script's comment for
# the full reasoning (1 starter/team at QB, ~2.5/team at RB, ~3/team at WR accounting for shared
# flex slots, ~1.25/team at TE).
VBD_REPLACEMENT_RANK = {"QB": 12, "RB": 30, "WR": 36, "TE": 15}

# This league's managers place much less TRADE value on QB (and, to a lesser extent, TE) than
# crowd/expert consensus would suggest - a single-QB, single-TE format where a startable
# replacement is usually one waiver claim away, so a real manager here won't give up a true
# difference-maker at another position for even an elite QB. QB gets cut hard (0.3x) rather than
# a mild haircut - per explicit league feedback, even THE best real QB shouldn't out-value a
# legitimate RB/WR1, and the raw VBD gap between an elite QB (outlier passing volume/TDs) and a
# replacement-level one is large enough that a mild discount still left him looking comparable to
# a true stud skill player, which isn't how this league actually trades. This scales down
# vbd_value (trade value) specifically for QB/TE - NOT ros_value (real projected points, used for
# the points-per-week display, which must stay an honest projection) and NOT anything in
# fetch_espn_draft.py's Draft Grades (a different, ADP/ECR-anchored context where matching
# consensus is the whole point). Applied once here, it flows through every trade comparison
# (fairness, needs/surplus, star-premium, waiver-pickup suggestions) without needing separate
# logic in trade-tools.html.
TRADE_VALUE_WEIGHT = {"QB": 0.3, "RB": 1.0, "WR": 1.0, "TE": 0.75}

LINEUP_SLOT_BENCH = 20
LINEUP_SLOT_IR = 21

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


def load_divisions():
    """Division per manager, read from the already-existing standings.json - no extra API call."""
    if not STANDINGS_PATH.exists():
        print(f"WARNING: {STANDINGS_PATH} not found - rosters will have division: null. "
              "Run fetch_espn_week.py first to populate it.")
        return {}
    with open(STANDINGS_PATH) as f:
        standings = json.load(f)
    return {s["manager"]: s.get("division") for s in standings.get("standings", [])}


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


def fetch_rosters_raw(league_id, season, creds):
    path = f"/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{league_id}"
    data = http_get(f"{API_HOST}{path}?view=mRoster&view=mSettings", creds=creds)
    teams = data.get("teams", [])
    current_week = data.get("scoringPeriodId", 1)
    matchup_period_count = data.get("settings", {}).get("scheduleSettings", {}).get("matchupPeriodCount", 14)
    weeks_remaining = max(matchup_period_count - current_week + 1, 1)
    print(f"Pulled current rosters for {len(teams)} teams from ESPN (league {league_id}, season {season}); "
          f"week {current_week} of {matchup_period_count} ({weeks_remaining} weeks remaining).")
    return teams, weeks_remaining


def fetch_wide_player_pool(season, creds):
    """Wide ~800-player pool from ESPN's public kona_player_info endpoint (same one
    fetch_espn_draft.py's fetch_player_pool() uses). Used for two things: the VBD replacement
    baseline (compute_vbd_baseline) and the free-agent pool (build_free_agents) - whichever of
    these players isn't rostered on any of the 12 teams."""
    path = f"/apis/v3/games/ffl/seasons/{season}/segments/0/leaguedefaults/3"
    filt = json.dumps({
        "players": {
            "limit": 800,
            "sortDraftRanks": {"sortPriority": 100, "sortAsc": True, "value": "STANDARD"},
            "filterStatsForSourceIds": {"value": [1]},
            "filterStatsForSplitTypeIds": {"value": [0]},
        }
    })
    data = http_get(f"{API_HOST}{path}?view=kona_player_info", creds=creds, extra_headers={"x-fantasy-filter": filt})
    pool = []
    for entry in data.get("players", []):
        p = entry.get("player", {})
        pos = DEFAULT_POSITION_MAP.get(p.get("defaultPositionId"))
        if pos not in VBD_REPLACEMENT_RANK:
            continue  # only need QB/RB/WR/TE - HC isn't in this endpoint, D/ST and K aren't rostered in this league
        projected_total = extract_stat(p.get("stats", []), season, statSourceId=1) or 0.0
        actual_so_far = extract_stat(p.get("stats", []), season, statSourceId=0) or 0.0
        pool.append({
            "espn_id": p.get("id"),
            "name": p.get("fullName", "Unknown"),
            "position": pos,
            "nfl_team": PRO_TEAM_ABBREV.get(p.get("proTeamId"), ""),
            "ros_value": round(max(projected_total - actual_so_far, 0.0), 1),
        })
    print(f"Pulled a wide {len(pool)}-player pool (VBD baseline + free-agent pool source).")
    return pool


def compute_vbd_baseline(wide_pool):
    by_position = {}
    for p in wide_pool:
        by_position.setdefault(p["position"], []).append(p["ros_value"])
    baseline = {}
    for pos, rank in VBD_REPLACEMENT_RANK.items():
        by_pts = sorted(by_position.get(pos, []), reverse=True)
        baseline[pos] = round(by_pts[min(rank, len(by_pts) - 1)], 1) if by_pts else 0.0
    return baseline


def compute_vbd_value(ros_value, position, vbd_baseline):
    """points-over-replacement, then scaled by TRADE_VALUE_WEIGHT - see that constant's comment
    for why QB/TE get scaled down here specifically (trade value) and nowhere else."""
    raw = ros_value - vbd_baseline.get(position, 0.0)
    return round(raw * TRADE_VALUE_WEIGHT.get(position, 1.0), 1)


# How many free agents to keep per position - enough that a suggested waiver pickup is never
# stale/wrong for long, without bloating the output file with the full ~800-player pool.
FREE_AGENT_POOL_SIZE = 8


def build_free_agents(wide_pool, rostered_ids, vbd_baseline):
    """Whichever wide-pool players aren't on any of the 12 rosters, top N per position by value -
    this is what pages/trade-tools.html suggests when a trade would leave a team with zero
    players at a position."""
    free_agents = {pos: [] for pos in VBD_REPLACEMENT_RANK}
    for p in wide_pool:
        if p["espn_id"] in rostered_ids:
            continue
        entry = dict(p)
        entry["vbd_value"] = compute_vbd_value(entry["ros_value"], entry["position"], vbd_baseline)
        free_agents.setdefault(entry["position"], []).append(entry)
    for pos in free_agents:
        free_agents[pos].sort(key=lambda p: -p["ros_value"])
        free_agents[pos] = free_agents[pos][:FREE_AGENT_POOL_SIZE]
    return free_agents


def extract_stat(stats, season, statSourceId):
    for s in stats:
        if s.get("seasonId") == season and s.get("statSourceId") == statSourceId and s.get("statSplitTypeId") == 0:
            return s.get("appliedTotal")
    return None


def resolve_roster_player(entry, season):
    p = entry.get("playerPoolEntry", {}).get("player", {})
    pos = DEFAULT_POSITION_MAP.get(p.get("defaultPositionId"), "UNK")
    projected_total = extract_stat(p.get("stats", []), season, statSourceId=1) or 0.0
    actual_so_far = extract_stat(p.get("stats", []), season, statSourceId=0) or 0.0
    ros_value = max(projected_total - actual_so_far, 0.0)
    return {
        "espn_id": p.get("id"),
        "name": p.get("fullName", "Unknown"),
        "position": pos,
        "nfl_team": PRO_TEAM_ABBREV.get(p.get("proTeamId"), ""),
        "lineup_slot_id": entry.get("lineupSlotId"),
        "projected_total": round(projected_total, 1),
        "actual_so_far": round(actual_so_far, 1),
        "ros_value": round(ros_value, 1),
    }


def assign_optimal_lineup(records):
    """Identical algorithm to fetch_espn_draft.py's assign_optimal_lineup - see that script for
    the full reasoning (greedy assignment is optimal for this nested/laminar flex-slot
    structure). Fed ros_value here (via each record's "projected_pts" key) instead of preseason
    projected points - same concept, current-season value instead."""
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
        else:  # TE
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


def build_rosters(teams_raw, vbd_baseline, team_map, divisions, season):
    teams_out = []
    for t in teams_raw:
        manager = resolve_manager(t["id"], team_map)
        entries = t.get("roster", {}).get("entries", [])
        players = [resolve_roster_player(e, season) for e in entries]
        for p in players:
            p["vbd_value"] = None if p["position"] == "HC" else compute_vbd_value(p["ros_value"], p["position"], vbd_baseline)
            p["projected_pts"] = p["ros_value"]  # feeds assign_optimal_lineup, stripped below
        assign_optimal_lineup(players)
        for p in players:
            del p["projected_pts"]
        teams_out.append({
            "manager": manager,
            "division": divisions.get(manager),
            "espn_team_id": t["id"],
            "roster_size": len(players),
            "players": players,
        })
    teams_out.sort(key=lambda t: t["manager"])
    return teams_out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--league-id", type=int, default=DEFAULT_LEAGUE_ID)
    parser.add_argument("--season", type=int, default=datetime.now().year)
    args = parser.parse_args()

    creds = load_credentials()
    team_map = load_team_map()
    divisions = load_divisions()

    teams_raw, weeks_remaining = fetch_rosters_raw(args.league_id, args.season, creds)
    wide_pool = fetch_wide_player_pool(args.season, creds)
    vbd_baseline = compute_vbd_baseline(wide_pool)

    teams_out = build_rosters(teams_raw, vbd_baseline, team_map, divisions, args.season)
    rostered_ids = {p["espn_id"] for t in teams_out for p in t["players"]}
    free_agents = build_free_agents(wide_pool, rostered_ids, vbd_baseline)
    print(f"Free agent pool: {', '.join(f'{pos} {len(v)}' for pos, v in free_agents.items())}")

    output = {
        "season": args.season,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "weeks_remaining": weeks_remaining,
        "vbd_baseline": vbd_baseline,
        "free_agents": free_agents,
        "methodology": {
            "note": ("Trade value = rest-of-season value (season-long projected points minus "
                     "points already scored) minus that position's replacement-level baseline "
                     "(the same points-over-replacement, or VBD, methodology used for Draft "
                     "Grades) - the number above each position is the baseline itself, in "
                     "season-long projected points, computed against a wide ~800-player pool, "
                     "not just this league's own rosters. Head Coach has no comparable "
                     "replacement pool at the same scale as skill positions, so it's excluded "
                     "from trade value/suggestions entirely (shown in rosters, not tradeable). "
                     "weeks_remaining is used to convert rest-of-season totals into a per-week "
                     "average; free_agents is the top-8-per-position pool of players rostered on "
                     "none of the 12 teams, used to suggest a waiver pickup when a trade would "
                     "leave a team with zero players at a position. Trade value (not raw "
                     f"points) is also scaled down for QB ({TRADE_VALUE_WEIGHT['QB']}x, a steep "
                     f"cut - not even an elite QB should out-value a real RB/WR1 here) and TE "
                     f"({TRADE_VALUE_WEIGHT['TE']}x) - this league trades those positions for "
                     "far less than general fantasy consensus would suggest, since a startable "
                     "replacement at either is usually one waiver claim away in a single-QB, "
                     "single-TE format."),
        },
        "teams": teams_out,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)
    print(f"Wrote {len(teams_out)} team rosters -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
