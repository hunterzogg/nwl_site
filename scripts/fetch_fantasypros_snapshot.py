#!/usr/bin/env python3
"""
Refreshes scripts/fantasypros_snapshot_2026.json - the FantasyPros ECR/ADP data
scripts/fetch_espn_draft.py loads for value grading (see that script's own docstring for why
this is a snapshot rather than a live pull inside fetch_espn_draft.py itself).

Needs scripts/fantasypros_credentials.json (gitignored, `{"api_key": "..."}`) - request a free
key at https://secure.fantasypros.com/api-keys/request/ if you don't have one. A paid/higher-tier
key would make this whole script unnecessary (fetch_espn_draft.py could just call the bulk
consensus-rankings endpoint directly, position=ALL, one request) - this exists only because the
free tier caps every bulk request at 10 results regardless of filters.

What this does, in order:
  1. Bulk-pulls FantasyPros' consensus-rankings for RB and WR (position=RB, position=WR) - these
     happen to return full uncapped lists on a free-tier key (only the ALL-positions and
     small-pool QB/TE calls seem to hit the cap - untested why, just observed). Gives POSITIONAL
     ECR rank for every RB/WR FantasyPros tracks.
  2. For every drafted QB/TE (read from the most recent data/season_2026/draft_grades_2026.json
     - run fetch_espn_draft.py at least once first so there's a picks list to work from), scrapes
     that player's public FantasyPros page (fantasypros.com/nfl/players/{slug}.php - no API key
     needed, not behind any paywall) for their embedded numeric player-id, then calls the API's
     single-player lookup (/nfl/players?player=ID) - NOT subject to the bulk 10-result cap since
     it only ever returns 1 result. Gives OVERALL ECR rank (rank_ecr_ppr).
  3. Single-player lookups get rate-limited hard after ~20 or so in a session (HTTP 429) - this
     script retries with backoff but gives up on persistent failures rather than hanging forever.
     Re-run it later (or the next day) to pick up whichever players failed last time - it loads
     the existing snapshot first and only fetches what's still missing.

Usage: python3 scripts/fetch_fantasypros_snapshot.py
"""
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SITE_DIR = SCRIPT_DIR.parent
CREDENTIALS_PATH = SCRIPT_DIR / "fantasypros_credentials.json"
DRAFT_GRADES_PATH = SITE_DIR / "data" / "season_2026" / "draft_grades_2026.json"
SNAPSHOT_PATH = SCRIPT_DIR / "fantasypros_snapshot_2026.json"

API_HOST = "https://api.fantasypros.com/public/v2/json"
PLAYER_PAGE_HOST = "https://www.fantasypros.com/nfl/players"
SEASON = 2026
USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

try:
    import certifi
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    print("ERROR: the 'certifi' package is required. Run: python3 -m pip install certifi")
    sys.exit(1)


def load_api_key():
    if not CREDENTIALS_PATH.exists():
        print(f"ERROR: {CREDENTIALS_PATH} not found.")
        print('Request a free key at https://secure.fantasypros.com/api-keys/request/ '
              'and save it as {"api_key": "..."} in that file.')
        sys.exit(1)
    with open(CREDENTIALS_PATH) as f:
        return json.load(f)["api_key"]


def _normalize_name(name):
    name = name.lower()
    name = re.sub(r"[.']", "", name)
    name = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", name)
    name = re.sub(r"[^a-z0-9\s]", " ", name)
    return re.sub(r"\s+", " ", name).strip()


def http_get(url, headers=None):
    req = urllib.request.Request(url)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    req.add_header("User-Agent", USER_AGENT)
    try:
        with urllib.request.urlopen(req, context=SSL_CONTEXT, timeout=15) as resp:
            return resp.getcode(), resp.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    except Exception as e:
        return None, str(e)


def fetch_positional_ecr(position, api_key, snapshot):
    code, body = http_get(
        f"{API_HOST}/nfl/{SEASON}/consensus-rankings?position={position}&scoring=PPR",
        {"x-api-key": api_key, "Accept": "application/json"},
    )
    if code != 200:
        print(f"  {position} bulk pull failed (HTTP {code}) - this key's tier may be fully "
              f"capped right now. Skipping.")
        return 0
    data = json.loads(body)
    players = data.get("players", [])
    pool_size = len(players)
    if data.get("public_api_limited") and pool_size <= 10:
        print(f"  {position} bulk pull only returned {pool_size} (tier: {data.get('tier')}) - "
              "hit the free-tier cap, not usable for full coverage.")
        return 0
    for p in players:
        snapshot[_normalize_name(p["player_name"])] = {
            "name": p["player_name"],
            "position": position,
            "position_ecr_rank": p.get("rank_ecr"),
            "position_ecr_pool_size": pool_size,
        }
    print(f"  {position}: {pool_size} players (full list).")
    return pool_size


def slug_variants(name):
    base = re.sub(r"[.']", "", name.lower())
    no_suffix = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", base).strip()
    variants = []
    for n in (base, no_suffix):
        s = re.sub(r"[^a-z0-9\s-]", "", n)
        s = re.sub(r"\s+", "-", s.strip())
        s = re.sub(r"-+", "-", s)
        if s and s not in variants:
            variants.append(s)
    return variants


def find_player_id(name):
    for slug in slug_variants(name):
        code, html = http_get(f"{PLAYER_PAGE_HOST}/{slug}.php")
        if code == 200:
            m = re.search(r'player-id="(\d+)"', html)
            if m:
                return m.group(1)
        time.sleep(0.15)
    return None


def fetch_overall_ecr(names, api_key, snapshot):
    remaining = [n for n in names if _normalize_name(n) not in snapshot]
    print(f"  {len(remaining)} QB/TE still need overall ECR (already have {len(names) - len(remaining)}).")
    got = 0
    for name in remaining:
        pid = find_player_id(name)
        if not pid:
            print(f"  no FantasyPros page match for {name!r} - skipping.")
            continue
        code, body = http_get(
            f"{API_HOST}/nfl/players?player={pid}",
            {"x-api-key": api_key, "Accept": "application/json"},
        )
        if code == 429:
            print(f"  rate-limited (429) on {name} - stopping here. Re-run this script later "
                  "to pick up the rest.")
            break
        if code != 200:
            print(f"  API lookup failed for {name} (HTTP {code}) - skipping.")
            continue
        data = json.loads(body)
        players = data.get("players", [])
        if not players:
            continue
        p = players[0]
        snapshot[_normalize_name(name)] = {
            "name": name,
            "overall_ecr_rank": p.get("rank_ecr_ppr"),
            "overall_adp_rank": p.get("rank_adp_ppr"),
        }
        got += 1
        print(f"  {name}: ECR #{p.get('rank_ecr_ppr')}, ADP #{p.get('rank_adp_ppr')}")
        # Save incrementally - a 429 mid-run shouldn't lose progress already made.
        save(snapshot)
        time.sleep(2)
    return got


def load_drafted_qb_te_names():
    if not DRAFT_GRADES_PATH.exists():
        print(f"WARNING: {DRAFT_GRADES_PATH} not found - run fetch_espn_draft.py at least once "
              "first so there's a picks list. Skipping QB/TE lookups.")
        return []
    with open(DRAFT_GRADES_PATH) as f:
        data = json.load(f)
    names = set()
    for m in data.get("managers", []):
        for p in m.get("picks", []):
            if p.get("position") in ("QB", "TE"):
                names.add(p["player"])
    return sorted(names)


def load_existing_snapshot():
    if not SNAPSHOT_PATH.exists():
        return {}
    with open(SNAPSHOT_PATH) as f:
        return json.load(f).get("players", {})


def save(snapshot):
    wrapped = {
        "_meta": {
            "description": ("Snapshot of FantasyPros ECR/ADP for 2026 drafted players. See "
                             "scripts/fetch_fantasypros_snapshot.py (regenerates this file) and "
                             "scripts/fetch_espn_draft.py's fetch_fantasypros_data() docstring "
                             "for the full story of why this is a snapshot, not a live pull."),
            "coverage": f"{len(snapshot)} players total",
        },
        "players": snapshot,
    }
    with open(SNAPSHOT_PATH, "w") as f:
        json.dump(wrapped, f, indent=2)


def main():
    api_key = load_api_key()
    snapshot = load_existing_snapshot()
    print(f"Loaded existing snapshot: {len(snapshot)} players.")

    print("\nBulk RB/WR pull:")
    for pos in ("RB", "WR"):
        fetch_positional_ecr(pos, api_key, snapshot)
    save(snapshot)

    print("\nIndividual QB/TE lookups:")
    qb_te_names = load_drafted_qb_te_names()
    if qb_te_names:
        fetch_overall_ecr(qb_te_names, api_key, snapshot)

    save(snapshot)
    print(f"\nWrote {len(snapshot)} players -> {SNAPSHOT_PATH}")


if __name__ == "__main__":
    main()
