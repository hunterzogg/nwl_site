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
build_trade_values.py uses for the free-agent pool), filtered to exactly the player IDs this pull
needs via x-fantasy-filter. Head Coach picks use negative synthetic IDs (ESPN's own convention
for this league's custom HC category) of the form -(14000 + proTeamId) - confirmed against the
real HC entries in ESPN roster data - so those resolve locally via
PRO_TEAM_NICKNAME instead of an API call (kona_player_info doesn't carry them).

Losing bids ("offers report"): ESPN doesn't expose a dedicated won/lost report the way its UI's
waiver summary implies - what it actually returns is every individual claim transaction, win or
lose, each tagged with its own status. A losing bid shows up as its own transaction with
status FAILED_INVALIDPLAYERSOURCE or FAILED_PLAYERALREADYDROPPED (ESPN's two ways of saying "someone
else got there first") and its real bidAmount intact - so the historical won-vs-lost pattern this
site already tracks (see data/transactions_with_dates.json's 2013-2025 rows) is reconstructible:
group every WAIVER-type transaction (any status) by the player being added, and for any player
multiple different teams tried to claim, the EXECUTED one is the winner and every FAILED one
(excluding FAILED_ROSTERLIMIT, which is a roster-mechanics failure unrelated to being outbid) from
a losing team is a real competing bid. Zero-dollar FAILED entries are dropped - those are usually a
stale PENDING claim resolving after someone else's free (uncontested) pickup already took the
player, not a real dollar amount ever having been on the table.

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
TRADES_PATH = SITE_DIR / "data" / "trades.json"
# Pieces ESPN doesn't record (FAAB is traded outside ESPN): [{season, date, manager, items: ["2 FAAB"]}]
TRADE_EXTRAS_PATH = SITE_DIR / "data" / "trade_extras.json"
DRAFT_2026_PATH = SITE_DIR / "data" / "season_2026" / "draft_grades_2026.json"

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


def find_losing_bids(all_tx):
    """Real competing losing bids - see module docstring's 'Losing bids' section. Returns
    (transaction, add_item) tuples, same shape cmd_fetch_transactions already works with."""
    by_player = {}
    for t in all_tx:
        if t.get("type") != "WAIVER":
            continue
        add = next((i for i in t["items"] if i["type"] == "ADD"), None)
        if add:
            by_player.setdefault(add["playerId"], []).append((t, add))

    losers = []
    for pid, group in by_player.items():
        teams = {t["teamId"] for t, _ in group}
        if len(teams) < 2:
            continue  # only one team ever went after this player - no competition to log
        for t, add in group:
            if (t["status"].startswith("FAILED") and t["status"] != "FAILED_ROSTERLIMIT"
                    and (t.get("bidAmount") or 0) > 0):
                losers.append((t, add))
    return losers


def fetch_roster_owners(league_id, season, period, creds, team_map):
    """{playerId: manager} for every rostered player (incl. IR) in a scoring period."""
    data = http_get(f"{API_HOST}/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{league_id}?view=mRoster&scoringPeriodId={period}", creds)
    return {e["playerPoolEntry"]["player"]["id"]: team_map.get(str(t["id"])) for t in data.get("teams", []) for e in t["roster"]["entries"]}


def detect_trades(all_tx, args, current_week, creds, team_map):
    """Completed trades for the season, as trades.json-style dicts with player ids/picks still unresolved.

    ESPN shows a trade's players only to the teams in it. For other trades it returns just the acceptance
    (time and accepting team), so those are reconstructed from rosters: a player who belonged to one team
    right before the trade (the previous scoring period's roster, updated by waiver/free-agent adds and drops
    made before the trade) and is on another team in the trade's scoring period, without that team having
    added him, changed hands in the trade. That catches same-day waiver pickups that were traded right away
    (Week 6 of 2026: Conlin claimed Kendrick Bourne at 3:58am ET and traded him to Palaia for Makai Lemon that
    afternoon, so Bourne was never on Conlin's roster in any scoring period)."""
    ms = lambda t: t.get("processDate") or t.get("proposedDate") or 0
    accepts = [t for t in all_tx if t.get("type") == "TRADE_ACCEPT" and t.get("status") == "EXECUTED"]
    by_id = {t["id"]: t for t in all_tx}
    groups = {}
    for t in accepts:  # proposer and accepter each get an acceptance row; group by the proposal
        groups.setdefault(t.get("relatedTransactionId") or t["id"], []).append(t)
    moves = [(ms(t), t["teamId"], i) for t in all_tx if t.get("status") == "EXECUTED" and t.get("type") in ("WAIVER", "FREEAGENT")
             for i in t.get("items", []) if i.get("type") in ("ADD", "DROP")]
    rosters = {}
    def roster(period):
        if period not in rosters:
            rosters[period] = fetch_roster_owners(args.league_id, args.season, period, creds, team_map)
        return rosters[period]
    trades, explained = [], set()
    for key, rows in sorted(groups.items(), key=lambda kv: min(ms(t) for t in kv[1])):
        when = min(ms(t) for t in rows)
        items = next((t["items"] for t in rows if t.get("items")), None) or (by_id.get(key) or {}).get("items") or []
        legs = [(i["fromTeamId"], i["toTeamId"], ("player", i["playerId"]) if i["type"] == "TRADE" else ("pick", i["overallPickNumber"]))
                for i in items if i.get("type") in ("TRADE", "DRAFT_TRADE")]
        if legs:
            for _, _, (kind, v) in legs:
                if kind == "player":
                    explained.add(v)
            teams = sorted({team_map.get(str(a)) for a, b, _ in legs} | {team_map.get(str(b)) for a, b, _ in legs})
            received = {m: [x for a, b, x in legs if team_map.get(str(b)) == m] for m in teams}
        else:
            period = max(1, rows[0].get("scoringPeriodId") or 1)
            before = dict(roster(max(0, period - 1)))
            for t_ms, team_id, i in sorted(moves, key=lambda m: m[0]):
                if t_ms <= when and i.get("playerId") in before or (t_ms <= when and i["type"] == "ADD"):
                    before[i["playerId"]] = team_map.get(str(team_id)) if i["type"] == "ADD" else None
            after = roster(min(period, current_week))
            added_later = {(team_map.get(str(team_id)), i["playerId"]) for t_ms, team_id, i in moves if t_ms > when and i["type"] == "ADD"}
            accepter = team_map.get(str(rows[0]["teamId"]))
            moved = [(pid, before[pid], after[pid]) for pid in before
                     if before[pid] and after.get(pid) and after[pid] != before[pid] and pid not in explained
                     and (after[pid], pid) not in added_later and accepter in (before[pid], after[pid])]
            if not moved:
                print(f"  WARNING: couldn't reconstruct the trade accepted by {accepter} on "
                      f"{datetime.fromtimestamp(when / 1000, tz=timezone.utc):%Y-%m-%d}; add it to trades.json by hand")
                continue
            partner = max({b if a == accepter else a for _, a, b in moved}, key=lambda m: sum(1 for _, a, b in moved if m in (a, b)))
            teams = sorted([accepter, partner])
            received = {m: [("player", pid) for pid, a, b in moved if b == m and a in teams] for m in teams}
            explained |= {pid for pid, _, _ in moved}
        trades.append({"when": when, "teams": teams, "received": received})
    return trades


def write_trades(trades, args, creds):
    """Rebuilds this season's rows in trades.json from detect_trades(); returns transaction-log rows."""
    ids = {v for t in trades for legs in t["received"].values() for kind, v in legs if kind == "player"}
    lookup = resolve_players(ids, args.season, creds)
    picks = {}
    if DRAFT_2026_PATH.exists() and args.season == 2026:  # which player each traded pick became
        for m in json.loads(DRAFT_2026_PATH.read_text()).get("managers", []):
            for p in m.get("picks", []):
                picks[p.get("pick")] = p.get("player")
    label = lambda kind, v: (lambda n, pos: f"{pos} - {n}")(*resolve_player(v, lookup)) if kind == "player" else f"Pick {v}" if kind == "pick" else v
    extras = json.loads(TRADE_EXTRAS_PATH.read_text()) if TRADE_EXTRAS_PATH.exists() else []
    rows, tx_rows = [], []
    for t in trades:
        date = datetime.fromtimestamp(t["when"] / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        for x in extras:
            if x["season"] == str(args.season) and x["date"] == date and x["manager"] in t["received"]:
                t["received"][x["manager"]] += [("extra", item) for item in x["items"]]
        a, b = t["teams"][0], t["teams"][1]
        rows.append({"season": str(args.season), "date": date, "precision": "exact_date",
                     "team1": a, "team1_received": "; ".join(label(k, v) for k, v in t["received"][a]),
                     "team2": b, "team2_received": "; ".join(label(k, v) for k, v in t["received"][b]),
                     **({"picks_used_on": {f"Pick {v}": picks[v] for legs in t["received"].values() for k, v in legs if k == "pick" and v in picks}}
                        if any(k == "pick" for legs in t["received"].values() for k, _ in legs) else {})})
        for m, legs in t["received"].items():
            for k, v in legs:
                if k == "extra" and v.endswith("FAAB"):
                    tx_rows.append({"season": str(args.season), "player": v, "position": "FAAB", "manager": m, "bid_amount": "",
                                    "acquisition_type": "trade", "bid_outcome": "", "date": date})
                if k == "player":
                    name, pos = resolve_player(v, lookup)
                    tx_rows.append({"season": str(args.season), "player": name, "position": pos, "manager": m, "bid_amount": "",
                                    "acquisition_type": "trade", "bid_outcome": "", "date": date})
    existing = json.loads(TRADES_PATH.read_text()) if TRADES_PATH.exists() else []
    existing = [r for r in existing if r.get("season") != str(args.season)] + rows
    TRADES_PATH.write_text(json.dumps(existing, separators=(", ", ": "), ensure_ascii=False))
    print(f"Wrote {len(rows)} {args.season} trades -> {TRADES_PATH}")
    return tx_rows


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
    executed = [(t, next((i for i in t["items"] if i["type"] == "ADD"), None))
                for t in all_tx if t.get("status") == "EXECUTED" and t.get("type") in ("WAIVER", "FREEAGENT")]
    executed = [(t, add) for t, add in executed if add]
    losing_bids = find_losing_bids(all_tx)

    player_ids = {add["playerId"] for _, add in executed} | {add["playerId"] for _, add in losing_bids}
    player_lookup = resolve_players(player_ids, args.season, creds)

    def build_row(t, add, bid_outcome):
        name, pos = resolve_player(add["playerId"], player_lookup)
        manager = team_map.get(str(t["teamId"]), f"UNMAPPED_TEAM_{t['teamId']}")
        ts = t.get("processDate") or t.get("proposedDate")
        date_str = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d") if ts else ""
        if bid_outcome == "won" and t["type"] == "FREEAGENT":
            acq_type, bid_amount = "free_agent", ""
        else:
            acq_type, bid_amount = "waiver", str(t.get("bidAmount", 0))
        return {
            "season": str(args.season), "player": name, "position": pos, "manager": manager,
            "bid_amount": bid_amount, "acquisition_type": acq_type, "bid_outcome": bid_outcome,
            "date": date_str,
        }

    rows = [build_row(t, add, "won") for t, add in executed]
    rows += [build_row(t, add, "lost") for t, add in losing_bids]
    try:
        rows += write_trades(detect_trades(all_tx, args, current_week, creds, team_map), args, creds)
    except Exception as e:  # noqa: BLE001 - never let trade detection break the waiver log
        print(f"WARNING: trades not updated: {e}")

    existing = json.loads(TRANSACTIONS_PATH.read_text()) if TRANSACTIONS_PATH.exists() else []
    existing = [r for r in existing if r.get("season") != str(args.season)]
    existing.extend(rows)
    # transactions_with_dates.json has always been stored as compact single-line JSON (unlike the
    # season_2026/*.json files, which are pretty-printed) - match that so a re-run's diff is just
    # the new rows, not a full reformat of 1800+ existing historical records.
    TRANSACTIONS_PATH.write_text(json.dumps(existing, separators=(", ", ": ")))
    print(f"Wrote {len(rows)} {args.season} rows ({len(executed)} won, {len(losing_bids)} lost competing bids) -> {TRANSACTIONS_PATH}")


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
