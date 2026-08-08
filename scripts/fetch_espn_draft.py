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
  2. kona_player_info (public, no auth needed) - the same projections endpoint the mock draft
     tool uses (see its own HANDOFF.md): each player's 2026 projected points
     (stats[{seasonId:2026,statSourceId:1,statSplitTypeId:0}].appliedTotal). Matched to draft
     picks by ESPN's numeric player ID - more reliable than the mock draft tool's name-matching,
     since draft picks and this endpoint share the same global ESPN player ID space.
  3. Head Coach picks (draftable in this league's format) come back from mDraftDetail with a
     negative playerId encoding the NFL team (-14000 - proTeamId, e.g. -14012 = Chiefs,
     proTeamId 12) since kona_player_info only covers skill-position players, not coaches.
     Projected points/ADP for coaches are read from pages/mock-draft.html's embedded coach
     pool (the same 32-team projected-wins-based dataset that tool already uses) rather than
     re-derived here.
  4. FantasyPros ECR (expert consensus rank - the signal draft value is graded against, see
     below) and ADP, loaded from scripts/fantasypros_snapshot_2026.json - NOT a live pull on
     every run. FantasyPros' official v2 API (scripts/fantasypros_credentials.json, gitignored,
     holds a personal API key) was the intended live source, but its free tier caps every bulk
     request at 10 results regardless of filters, and rate-limits individual single-player
     lookups hard after ~20 calls in a session - discovered by testing, not documented anywhere.
     The snapshot was hand-assembled this session via a mix of (a) a brief window where bulk
     RB/WR pulls returned full uncapped data before the key's access degraded (100% of drafted
     RB/WR covered), and (b) individual single-player API lookups for QB/TE, with player IDs
     resolved by scraping each player's public FantasyPros page (no API key needed for that
     step) - rate-limited before finishing, so only 22 of 36 drafted QBs/TEs are covered. See
     fetch_fantasypros_data()'s docstring and the snapshot file's own "_meta" key for the full
     story, including how to refresh it (ideally with a paid/higher-tier key).

Grading methodology (adapted from pages/mock-draft.html's computeGrades/computePickGrades -
see draft_grades_2026.json's "methodology" field for the exact weights):
  - Starter/bench slotting is NOT read from ESPN's live roster (which changes all season) and
    is NOT just "whoever was drafted into which round" - it's the actual best possible starting
    lineup: every manager's full 15-man draft class is re-assigned to the 9 starting slots (1
    QB, 2 RB, 2 WR, 1 TE, 1 TE/WR flex, 1 FLEX (RB/WR/TE), 1 HC) by projected points, most
    valuable player in each eligible slot wins it - not simply the order things were drafted
    in. Everyone else is bench.
  - Team grade = percentile blend of four signals: (a) starting lineup's total projected points
    - the heaviest-weighted signal, (b) bench's total projected points, (c) value captured vs
    ECR (round-weighted, across the whole roster - see below, NOT simply "picked ahead of or
    behind ADP"), (d) upside (points over each position's VBD replacement baseline, round-
    weighted, across the whole roster - no rookie/breakout bonus here, unlike the mock draft
    tool, since ESPN's live API doesn't expose either flag for real players).
  - Position sub-grades (QB/RB/WR/TE/HC) use a separate 3-way blend (points/value/upside,
    points-dominant) scoped to ONLY that position's starters - a bench-buried 4th WR doesn't
    move the WR grade either way. The bench-only grade badge uses the same 3-way blend, scoped
    to a manager's bench-slotted picks regardless of position.
  - **Value captured vs ECR, not ADP**: per explicit request ("a better indicator of value
    capture rather than just picking ahead or behind the ADP"), the value signal is NOT
    `pick_number - adp`. It mirrors this site's own long-standing historical draft-grading
    convention (`scripts/build_draft_grades.py` / `pages/draft.html`'s `position_draft_rank` vs
    `position_finish_rank`) - just substituting **ECR position rank** in place of a finish rank
    that doesn't exist yet for an unplayed season. For every skill pick: `position_draft_rank`
    = which Nth player at that position was taken in the REAL draft (league-wide order, e.g.
    "the 8th RB off the board"); `position_ecr_rank` = FantasyPros' expert-consensus positional
    rank for that player. `ecr_value = position_draft_rank - position_ecr_rank` (positive = the
    player fell past where experts ranked him at his position = real value; negative = taken
    ahead of expert consensus = a reach) - normalized by dividing by the position's ECR pool
    size (same `normalized_diff` convention as the historical file) before feeding the grade
    blend, so a QB pool of ~50 and a WR pool of ~250 stay comparable. ADP is still pulled and
    shown for context (see per-pick `adp`), it just no longer drives the grade math.

Setup: identical to fetch_espn_week.py for ESPN auth - needs scripts/espn_credentials.json
(gitignored, personal ESPN login cookies) already in place. This script itself does NOT need a
FantasyPros API key - it just reads scripts/fantasypros_snapshot_2026.json. To refresh that
snapshot, run scripts/fetch_fantasypros_snapshot.py, which does need
scripts/fantasypros_credentials.json (gitignored, `{"api_key": "..."}`).
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
FANTASYPROS_SNAPSHOT_PATH = SCRIPT_DIR / "fantasypros_snapshot_2026.json"
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
# bench points, ECR value, and upside all still count, but starting-lineup output dominates
# since that's what actually scores.
GRADE_WEIGHTS = {"starter_points": 0.55, "bench_points": 0.15, "value": 0.15, "upside": 0.15}

# Position sub-grades and the bench-only badge use a separate points-dominant 3-way blend
# (unchanged from the original single-signal-set formula) - only the overall team grade above
# was split into the 4-way starter/bench breakdown.
SUBGRADE_WEIGHTS = {"points": 0.80, "value": 0.08, "upside": 0.12}

# Per-pick grade (shown when a manager's row is expanded on the Grades tab): mirrors
# pages/mock-draft.html's computePickGrades (mostly "how good is this player" with ECR value as
# a smaller adjustment) - percentile-ranked across all 180 real picks, not per-manager, so a
# pick's grade reflects how it stacks up against the whole draft.
PICK_GRADE_WEIGHTS = {"quality": 0.75, "value": 0.25}

# Contender Profile (informational only - see build_contender_profile): how many of a manager's
# picks project as a top-12 / top-24 fantasy finisher at their position, blended 60/40 since
# top-12 depth was the tighter of the two historical correlates with actually winning the
# league (see the "historical_context" written into the output file for the real numbers).
CONTENDER_WEIGHTS = {"top12": 0.6, "top24": 0.4}

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


def _normalize_name(name):
    """Loose match key for cross-source name matching (ESPN vs FantasyPros): lowercase, drop
    punctuation and Jr./Sr./II/III/IV suffixes, collapse whitespace."""
    name = name.lower()
    name = re.sub(r"[.']", "", name)
    name = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", name)
    name = re.sub(r"[^a-z0-9\s]", " ", name)
    return re.sub(r"\s+", " ", name).strip()


def fetch_fantasypros_data(season):
    """FantasyPros ECR/ADP, keyed by normalized player name. Returns entries in one of two
    shapes depending on how that player's data was obtained (see scripts/fantasypros_snapshot_2026.json
    and its own header comment for the full story of why):
      - RB/WR: {"position_ecr_rank": N, "position_ecr_pool_size": N} - positional ECR rank, from
        FantasyPros' bulk consensus-rankings endpoint (position=RB or WR), which happened to
        return full uncapped lists before this key's access degraded to its free-tier cap.
      - QB/TE (partial - 22 of 36 drafted QBs/TEs): {"overall_ecr_rank": N, "overall_adp_rank": N}
        - OVERALL rank (not positional), from FantasyPros' single-player lookup endpoint
        (/nfl/players?player=ID), which is NOT subject to the bulk 10-result cap - fetched one
        player at a time via their public player-page HTML (to resolve name -> FantasyPros
        player ID) then the API. Rate-limited hard after ~20 calls in a session, so 14 of the
        168 drafted skill players have no live ECR data at all - those fall back to a neutral
        (0.0) value contribution, not a guess.
    This is a snapshot (scripts/fantasypros_snapshot_2026.json), not a live pull on every run -
    FantasyPros' free API tier caps bulk requests at 10 results and rate-limits individual
    lookups aggressively, so re-fetching this on every script run isn't practical. Re-run the
    one-off fetch (see HANDOFF.md) and overwrite that file if you want fresher numbers, ideally
    with a paid/higher-tier key so it can be a real live pull like the rest of this script."""
    if not FANTASYPROS_SNAPSHOT_PATH.exists():
        print(f"WARNING: {FANTASYPROS_SNAPSHOT_PATH} not found - value grading will have no ECR "
              "signal (falls back to neutral for every pick). See that file's absence: it's a "
              "one-off hand-fetched snapshot, not auto-generated by this script.")
        return {}
    with open(FANTASYPROS_SNAPSHOT_PATH) as f:
        snapshot = json.load(f)["players"]
    print(f"Loaded FantasyPros ECR/ADP snapshot for {len(snapshot)} players "
          f"({FANTASYPROS_SNAPSHOT_PATH.name}).")
    return snapshot


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
    fp_data = fetch_fantasypros_data(season)
    pool = {}
    fp_ecr_matched = 0
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
        name = p.get("fullName", f"Player {pid}")
        espn_adp = p.get("ownership", {}).get("averageDraftPosition") or 999.0
        dr = p.get("draftRanksByRankType", {}).get("STANDARD", {}).get("rank") or espn_adp
        fp_match = fp_data.get(_normalize_name(name), {})
        if fp_match.get("position_ecr_rank") is not None or fp_match.get("overall_ecr_rank") is not None:
            fp_ecr_matched += 1
        # ADP display is ESPN's own number for EVERY player, uniformly - not FantasyPros', even
        # for the 22 QB/TE that happen to have a FantasyPros overall_adp_rank. Mixing two ADP
        # sources with different scales/precision on the same "ADP" column would skew the
        # Reaches & Steals tab (e.g. making QB/TE look like outsized reaches/steals just because
        # FantasyPros' ADP differs systematically from ESPN's, not because of real value). ADP is
        # purely informational now anyway - grading reads position_ecr_rank/overall_ecr_rank.
        pool[pid] = {
            "name": name,
            "pos": pos,
            "nfl_team": PRO_TEAM_ABBREV.get(p.get("proTeamId"), ""),
            "pts": round(pts, 1),
            "adp": espn_adp,
            "espn_adp": espn_adp,
            "dr": dr,
            "position_ecr_rank": fp_match.get("position_ecr_rank"),
            "position_ecr_pool_size": fp_match.get("position_ecr_pool_size"),
            "overall_ecr_rank": fp_match.get("overall_ecr_rank"),
        }
    print(f"Pulled {len(pool)} skill-position players' projections from ESPN.")
    if fp_data:
        print(f"Matched {fp_ecr_matched}/{len(pool)} to FantasyPros ECR (the grading signal). "
              "ADP display uses ESPN's own number uniformly (see fetch_player_pool comment).")
    assign_position_pool_ranks(pool)
    return pool


def assign_position_pool_ranks(player_pool):
    """Ranks every pooled player against others at their own position by projected points, and
    mutates each entry with position_pool_rank/position_pool_size - feeds the Contender Profile's
    top-12/top-24 "difference-maker depth" metric (see build_contender_profile)."""
    by_pos = {}
    for entry in player_pool.values():
        by_pos.setdefault(entry["pos"], []).append(entry)
    for pos, entries in by_pos.items():
        entries.sort(key=lambda e: -e["pts"])
        for i, entry in enumerate(entries):
            entry["position_pool_rank"] = i + 1
            entry["position_pool_size"] = len(entries)


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
                     "pts": coach.get("pts", 0.0), "adp": coach.get("adp", 999.0), "dr": coach.get("adp", 999.0),
                     "position_pool_rank": None, "position_pool_size": None,
                     "position_ecr_rank": None, "position_ecr_pool_size": None, "overall_ecr_rank": None}
        return {"name": f"{abbrev or 'Unknown'} Head Coach", "pos": "HC", "nfl_team": abbrev,
                 "pts": 0.0, "adp": 999.0, "dr": 999.0, "position_pool_rank": None, "position_pool_size": None,
                 "position_ecr_rank": None, "position_ecr_pool_size": None, "overall_ecr_rank": None}
    return {"name": f"Unmatched Player {pid}", "pos": "UNK", "nfl_team": "",
             "pts": 0.0, "adp": 999.0, "dr": 999.0, "position_pool_rank": None, "position_pool_size": None,
             "position_ecr_rank": None, "position_ecr_pool_size": None, "overall_ecr_rank": None}


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


def compute_pick_grades(all_picks_flat):
    """Mutates every record in all_picks_flat with pick_grade/pick_percentile - quality (VBD)
    percentile-ranked across the whole draft, blended with ECR-value percentile per
    PICK_GRADE_WEIGHTS. Head Coach picks have no ECR data, so they're graded on quality
    alone (consistent with how the rest of this script already treats them)."""
    quality_pct = percentile_ranks({i: r["vbd"] for i, r in enumerate(all_picks_flat)})
    value_pct = percentile_ranks({i: r["value"] for i, r in enumerate(all_picks_flat)})
    for i, r in enumerate(all_picks_flat):
        if r["position"] == "HC":
            pct = quality_pct[i]
        else:
            pct = (PICK_GRADE_WEIGHTS["quality"] * quality_pct[i]
                   + PICK_GRADE_WEIGHTS["value"] * value_pct[i])
        r["pick_grade"] = gradeLetter(pct)
        r["pick_percentile"] = round(pct, 4)


# The three historical findings from analyzing all 13 NWL championship-winning drafts (see
# HANDOFF.md for the full writeup and how these were derived from data/team_seasons_playoff.json
# + data/draft_picks.json + data/draft_grades.json) - written once here so build_contender_profile
# and the output JSON both quote the exact same numbers.
CONTENDER_HISTORICAL_CONTEXT = {
    "sample_size": 13,
    "position_mix_finding": ("Positional pick mix (RB%/WR%/QB%/TE% of total picks) does NOT "
                              "distinguish champions from the field - champions drafted ~31% RB "
                              "/ ~36% WR, statistically identical to everyone else."),
    "draft_value_finding": ("Our own draft-grade methodology (ADP value vs. eventual finish) is "
                             "a weak predictor - the champion's within-season draft-grade rank "
                             "averaged 6th of ~12 (league-average) across 13 years, and the 2014 "
                             "champion (Glaser) had the single WORST-graded draft in the league "
                             "that year and still won it all."),
    "difference_maker_finding": ("The best signal found was \"difference-maker depth\" - how "
                                  "many picks finished as a top-12 or top-24 fantasy performer "
                                  "at their position that season, regardless of when drafted. "
                                  "Champions averaged roughly top-3-of-12 in the league on this "
                                  "measure - a real but only moderate correlation, not a "
                                  "guarantee."),
    "note": ("This is why Contender Profile is informational only and is NOT blended into the "
              "overall/position/bench grades above - the historical signal is real but too weak "
              "to justify moving a team's letter grade on it. 2026 has no actual finishes yet, "
              "so top-12/top-24 hits here are proxied by each pick's projected points rank "
              "against the full 2026 projected pool at their position, the same shape as the "
              "historical metric."),
}


def compute_contender_profile(all_picks_by_manager):
    top12_hits, top24_hits = {}, {}
    for mgr, recs in all_picks_by_manager.items():
        skill_recs = [r for r in recs if r["position"] != "HC"]
        top12_hits[mgr] = sum(1 for r in skill_recs if r["is_top12"])
        top24_hits[mgr] = sum(1 for r in skill_recs if r["is_top24"])

    graded = blended_grade({"top12": top12_hits, "top24": top24_hits}, CONTENDER_WEIGHTS)

    managers_out = {}
    for mgr in all_picks_by_manager:
        managers_out[mgr] = {
            "top12_hits": top12_hits[mgr],
            "top24_hits": top24_hits[mgr],
            "percentile": graded[mgr]["percentile"],
            "grade": graded[mgr]["grade"],
        }
    return {"historical_context": CONTENDER_HISTORICAL_CONTEXT, "weights": CONTENDER_WEIGHTS, "managers": managers_out}


def build_grades(picks, player_pool, coach_pool, team_map):
    vbd_baseline = compute_vbd_baseline(player_pool)

    all_picks_by_manager = {}  # manager -> list of pick records
    position_draft_counter = {}  # position -> how many taken so far, league-wide draft order
    for pick in sorted(picks, key=lambda p: p["overallPickNumber"]):
        manager = resolve_manager(pick["teamId"], team_map)
        player = resolve_pick_player(pick, player_pool, coach_pool)
        vbd = upside_score(player, vbd_baseline)
        pool_rank = player.get("position_pool_rank")
        pool_size = player.get("position_pool_size")

        # Value captured vs ECR (see module docstring) - NOT pick vs ADP. Two data shapes,
        # depending on what FantasyPros' rate-limited free tier let us get for this player (see
        # fetch_fantasypros_data): (a) RB/WR - position_draft_rank (this player's spot in
        # league-wide draft order among others at the same position, e.g. "the 8th RB off the
        # board") vs FantasyPros' POSITIONAL ECR rank, normalized by the ECR pool size so
        # positions with different pool sizes stay comparable (same convention as
        # scripts/build_draft_grades.py's historical normalized_diff); (b) QB/TE (partial
        # coverage - see snapshot file) - only an OVERALL ECR rank was obtainable, so this falls
        # back to overall pick number vs overall ECR rank, divided by the ~180-pick draft size to
        # land on a roughly comparable scale. Picks with no ECR data at all (the free tier
        # couldn't be coaxed into covering every player) get a neutral 0.0 - not a guess.
        ecr_rank = player.get("position_ecr_rank")
        ecr_pool_size = player.get("position_ecr_pool_size")
        overall_ecr_rank = player.get("overall_ecr_rank")
        position_draft_rank = None
        ecr_value = None
        normalized_value = 0.0
        if ecr_rank is not None:
            position_draft_counter[player["pos"]] = position_draft_counter.get(player["pos"], 0) + 1
            position_draft_rank = position_draft_counter[player["pos"]]
            ecr_value = position_draft_rank - ecr_rank
            normalized_value = ecr_value / ecr_pool_size if ecr_pool_size else 0.0
        elif overall_ecr_rank is not None:
            ecr_value = pick["overallPickNumber"] - overall_ecr_rank
            normalized_value = ecr_value / len(picks)

        record = {
            "round": pick["roundId"],
            "pick": pick["overallPickNumber"],
            "round_pick": pick["roundPickNumber"],
            "player": player["name"],
            "position": player["pos"],
            "nfl_team": player["nfl_team"],
            "projected_pts": player["pts"],
            "adp": round(player["adp"], 1) if player["adp"] < 999 else None,
            "position_ecr_rank": ecr_rank,
            "position_ecr_pool_size": ecr_pool_size,
            "overall_ecr_rank": overall_ecr_rank,
            "position_draft_rank": position_draft_rank,
            "ecr_value": ecr_value,
            "value": round(normalized_value, 4),
            "vbd": round(vbd, 1),
            "keeper": pick.get("keeper", False),
            "position_pool_rank": pool_rank,
            "position_pool_size": pool_size,
            "is_top12": pool_rank is not None and pool_rank <= 12,
            "is_top24": pool_rank is not None and pool_rank <= 24,
        }
        all_picks_by_manager.setdefault(manager, []).append(record)

    # Per-pick grade (mostly "how good is this player," with ECR value as a smaller adjustment),
    # percentile-ranked across ALL 180 real picks - shown when a manager's row is expanded.
    compute_pick_grades([r for recs in all_picks_by_manager.values() for r in recs])

    # Assigns each manager's full draft class to the best possible starting lineup by
    # projected points (see assign_optimal_lineup) - sets "slot"/"is_starter" on every record.
    for recs in all_picks_by_manager.values():
        assign_optimal_lineup(recs)

    # ---- Overall team grades: starter pts (heaviest), bench pts, ECR value, upside ----
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
            "avg_ecr_value": round(avg_value[mgr], 4),
            "avg_upside": round(avg_upside[mgr], 1),
            "position_grades": position_grades[mgr],
            "bench_grade": {
                "grade": bench_graded[mgr]["grade"],
                "percentile": bench_graded[mgr]["percentile"],
                "total_projected_pts": round(bench_pts[mgr], 1),
            },
            "picks": sorted(all_picks_by_manager[mgr], key=lambda r: r["pick"]),
        })

    contender_profile = compute_contender_profile(all_picks_by_manager)
    return managers_out, contender_profile


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

    managers_out, contender_profile = build_grades(picks, player_pool, coach_pool, team_map)

    output = {
        "season": args.season,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "methodology": {
            "grade_weights": GRADE_WEIGHTS,
            "note": ("Grades are based on 2026 preseason projections, not actual season results "
                     "(the season hasn't happened yet). Starters/bench reflect each manager's "
                     "best possible lineup (highest-projected players by slot eligibility - 1 "
                     "QB, 2 RB, 2 WR, 1 TE, 1 TE/WR flex, 1 FLEX, 1 HC), not ESPN's live roster "
                     "or draft order. Overall grade = percentile blend of "
                     f"starting-lineup points ({round(GRADE_WEIGHTS['starter_points']*100)}%, "
                     "the heaviest signal), bench points "
                     f"({round(GRADE_WEIGHTS['bench_points']*100)}%), value captured vs ECR "
                     f"({round(GRADE_WEIGHTS['value']*100)}%, NOT simply picked ahead of or "
                     "behind ADP - see position_draft_rank/position_ecr_rank on each pick), "
                     f"and VBD upside ({round(GRADE_WEIGHTS['upside']*100)}%). Each pick's own "
                     "Value grade (shown when a manager's row is expanded) is a separate blend - "
                     f"{round(PICK_GRADE_WEIGHTS['quality']*100)}% quality (points over "
                     f"replacement) / {round(PICK_GRADE_WEIGHTS['value']*100)}% ECR value - "
                     "percentile-ranked across all 180 real picks, not per-manager. Real market "
                     "ADP (live from FantasyPros) is still shown per pick for context, it just "
                     "no longer drives the grade math."),
        },
        "managers": managers_out,
        "contender_profile": contender_profile,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)
    print(f"Wrote {len(managers_out)} manager grades -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
