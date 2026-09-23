#!/usr/bin/env python3
"""
Pulls executed free agent / waiver acquisitions from ESPN and appends any new ones into
data/transactions_with_dates.json (season "2026"), so pages/transactions.html's existing
Transaction Log tab picks them up automatically via its season filter - no site code changes
needed, same file historical 2013-2025 data already lives in.

Why this is a separate script from fetch_espn_week.py: ESPN's mTransactions2 view doesn't return
the whole season in one call the way mMatchupScore does for matchups - passing a `scoringPeriodId`
query param returns a rolling window of transactions *around* that period (overlapping, with real
gaps if you only ever ask for the current week), not a clean per-week filter. So this script
queries scoringPeriodId 0 through the current week and merges the results by transaction id to
get full-season coverage, then filters down to status EXECUTED + type WAIVER/FREEAGENT (actual
successful pickups - failed/pending/canceled claims and roster/lineup transactions are excluded).

Safe to re-run any time (e.g. right after a Tuesday waiver run) - it's a merge, not an overwrite:
existing 2026 rows already in transactions_with_dates.json are dropped and rebuilt from this
pull's `season == "2026"` entries each time, exactly like fetch_espn_week.py overwrites the
current week's matchups.json entry. Historical 2013-2025 rows are never touched.

Player names/positions are resolved via ESPN's public kona_player_info endpoint (same one
fetch_espn_rosters.py uses for the free-agent pool), filtered to exactly the player IDs this pull
needs via x-fantasy-filter. Head Coach picks use negative synthetic IDs (ESPN's own convention
for this league's custom HC category) of the form -(14000 + proTeamId) - confirmed against the
real HC entries already sitting in data/season_2026/rosters.json - so those resolve locally via
PRO_TEAM_NICKNAME instead of an API call (kona_player_info doesn't carry them).

Setup: identical to fetch_espn_week.py - needs scripts/espn_credentials.json and
scripts/espn_team_map.json already in place.
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
TRANSACTIONS_PATH = SITE_DIR / "data" / "transactions_with_dates.json"

DEFAULT_LEAGUE_ID = 39276
API_HOST = "https://lm-api-reads.fantasy.espn.com"

POS_MAP = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST"}
PRO_TEAM_NICKNAME = {
    1: "Falcons", 2: "Bills", 3: "Bears", 4: "Bengals", 5: "Browns", 6: "Cowboys", 7: "Broncos",
    8: "Lions", 9: "Packers", 10: "Titans", 11: "Colts", 12: "Chiefs", 13: "Raiders", 14: "Rams",
    15: "Dolphins", 16: "Vikings", 17: "Patriots", 18: "Saints", 19: "Giants", 20: "Jets",
    21: "Eagles", 22: "Cardinals", 23: "Steelers", 24: "Chargers", 25: "49ers", 26: "Seahawks",
    27: "Buccaneers", 28: "Commanders", 29: "Panthers", 30: "Jaguars", 33: "Ravens", 34: "Texans",
}

try:
    import certifi
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    print("ERROR: the 'certifi' package is required (fixes a common macOS SSL certificate issue).")
    print("Run: python3 -m pip install certifi")
    sys.exit(1)


def load_credentials():
    if not CREDENTIALS_PATH.exists():
        print(f"ERROR: {CREDENTIALS_PATH} not found. See fetch_espn_week.py's docstring for setup.")
        sys.exit(1)
    with open(CREDENTIALS_PATH) as f:
        return json.load(f)


def load_team_map():
    if not TEAM_MAP_PATH.exists():
        print(f"ERROR: {TEAM_MAP_PATH} not found. Run fetch_espn_week.py --map-teams first.")
        sys.exit(1)
    with open(TEAM_MAP_PATH) as f:
        return json.load(f)


def http_get(url, creds, extra_headers=None):
    req = urllib.request.Request(url)
    req.add_header("Cookie", f"espn_s2={creds['espn_s2']}; SWID={creds['swid']}")
    req.add_header("Accept", "application/json")
    for k, v in (extra_headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, context=SSL_CONTEXT) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 401:
            print("ERROR: 401 Unauthorized - your espn_s2/SWID cookies are expired. See fetch_espn_week.py's docstring.")
        else:
            print(f"ERROR: ESPN API returned {e.code}")
            print(e.read().decode(errors="replace")[:500])
        sys.exit(1)


def fetch_all_transactions(league_id, season, current_week, creds):
    """Merges overlapping per-scoringPeriodId transaction pages into one deduped set, keyed by
    transaction id - see module docstring for why a single call isn't enough."""
    path = f"/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{league_id}"
    all_tx = {}
    for wk in range(0, current_week + 1):
        data = http_get(f"{API_HOST}{path}?view=mTransactions2&scoringPeriodId={wk}", creds)
        for t in data.get("transactions", []):
            all_tx[t["id"]] = t
    return list(all_tx.values())


def resolve_players(player_ids, season, creds):
    """Public kona_player_info endpoint, filtered to exactly the given (positive) IDs."""
    positive_ids = [p for p in player_ids if p >= 0]
    if not positive_ids:
        return {}
    path = f"/apis/v3/games/ffl/seasons/{season}/segments/0/leaguedefaults/3"
    filt = json.dumps({"players": {"filterIds": {"value": positive_ids}}})
    data = http_get(f"{API_HOST}{path}?view=kona_player_info", creds, extra_headers={"x-fantasy-filter": filt})
    lookup = {}
    for entry in data.get("players", []):
        p = entry["player"]
        lookup[p["id"]] = (p.get("fullName", f"Player #{p['id']}"), POS_MAP.get(p.get("defaultPositionId"), "?"))
    return lookup


def resolve_player(pid, player_lookup):
    if pid >= 0:
        return player_lookup.get(pid, (f"Unknown Player #{pid}", "?"))
    pro_team_id = -pid - 14000
    nick = PRO_TEAM_NICKNAME.get(pro_team_id, f"Team{pro_team_id}")
    return f"{nick} Coach", "HC"


def cmd_fetch_transactions(args, creds):
    team_map = load_team_map()
    data = http_get(
        f"{API_HOST}/apis/v3/games/ffl/seasons/{args.season}/segments/0/leagues/{args.league_id}?view=mStatus",
        creds,
    )
    current_week = args.week or data.get("scoringPeriodId")
    if not current_week:
        print("ERROR: could not auto-detect the current week, and none was given via --week.")
        sys.exit(1)

    all_tx = fetch_all_transactions(args.league_id, args.season, current_week, creds)
    executed = [t for t in all_tx if t.get("status") == "EXECUTED" and t.get("type") in ("WAIVER", "FREEAGENT")]

    player_ids = {i["playerId"] for t in executed for i in t["items"] if i["type"] == "ADD"}
    player_lookup = resolve_players(player_ids, args.season, creds)

    rows = []
    for t in executed:
        add = next((i for i in t["items"] if i["type"] == "ADD"), None)
        if not add:
            continue
        name, pos = resolve_player(add["playerId"], player_lookup)
        manager = team_map.get(str(t["teamId"]), f"UNMAPPED_TEAM_{t['teamId']}")
        ts = t.get("processDate") or t.get("proposedDate")
        date_str = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d") if ts else ""
        if t["type"] == "FREEAGENT":
            acq_type, bid_amount, bid_outcome = "free_agent", "", ""
        else:
            acq_type, bid_amount, bid_outcome = "waiver", str(t.get("bidAmount", 0)), "won"
        rows.append({
            "season": str(args.season),
            "player": name,
            "position": pos,
            "manager": manager,
            "bid_amount": bid_amount,
            "acquisition_type": acq_type,
            "bid_outcome": bid_outcome,
            "date": date_str,
        })

    existing = json.loads(TRANSACTIONS_PATH.read_text()) if TRANSACTIONS_PATH.exists() else []
    existing = [r for r in existing if r.get("season") != str(args.season)]
    existing.extend(rows)
    # transactions_with_dates.json has always been stored as compact single-line JSON (unlike the
    # season_2026/*.json files, which are pretty-printed) - match that so a re-run's diff is just
    # the new rows, not a full reformat of 1800+ existing historical records.
    TRANSACTIONS_PATH.write_text(json.dumps(existing, separators=(", ", ": ")))
    print(f"Wrote {len(rows)} {args.season} acquisitions (of {len(executed)} executed adds seen) -> {TRANSACTIONS_PATH}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--league-id", type=int, default=DEFAULT_LEAGUE_ID)
    parser.add_argument("--season", type=int, default=datetime.now().year)
    parser.add_argument("--week", type=int, default=None, help="Defaults to ESPN's current scoring period")
    args = parser.parse_args()

    creds = load_credentials()
    cmd_fetch_transactions(args, creds)


if __name__ == "__main__":
    main()
