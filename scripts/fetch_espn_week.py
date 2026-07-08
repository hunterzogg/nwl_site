#!/usr/bin/env python3
"""
Pulls this week's matchups + standings from the NWL's private ESPN Fantasy Football
league and writes them into data/season_2026/. Run this once a week during the season
(or anytime you want a fresher snapshot - it's safe to re-run, it just overwrites the
current week's entry).

Setup (one-time):
  1. Copy scripts/espn_credentials.example.json to scripts/espn_credentials.json
  2. Fill in espn_s2 and swid - see "How to get your ESPN cookies" below.
  3. Run: python3 scripts/fetch_espn_week.py --map-teams
     This prints every team ESPN has on file so you can fill in scripts/espn_team_map.json
     (maps ESPN team ID -> the manager name used everywhere else on the site).
  4. Run: python3 scripts/fetch_espn_week.py
     Pulls the current week and writes matchups.json + standings.json (facts, no review needed).
     Also computes a power_rankings.json draft (see POWER_WEIGHTS below for the methodology -
     record + scoring + expected wins + recent form, all data-driven, no opinion) and a blank
     commentary.json stub. Both are written with "published": false - review/edit the blurbs and
     the recap text, then flip that flag to true. Nothing here auto-publishes.

How to get your ESPN cookies (private leagues only):
  1. Log into your league at fantasy.espn.com in a normal browser tab.
  2. Open DevTools (F12 or Cmd+Opt+I) -> Application/Storage tab -> Cookies -> espn.com.
  3. Copy the value of "espn_s2" (a long string) and "SWID" (looks like {XXXXXXXX-XXXX-...}).
  4. Paste both into scripts/espn_credentials.json. Keep the curly braces on SWID.
  These cookies are tied to your ESPN login session and can expire - if the script starts
  getting 401s again, just repeat these steps to get fresh values.

Never commit or share espn_credentials.json - it's your personal login session.
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

DEFAULT_LEAGUE_ID = 39276
API_HOST = "https://lm-api-reads.fantasy.espn.com"

# Power ranking composite weights - must sum to 1. Tune these here; nothing else needs to change.
POWER_WEIGHTS = {
    "expected_win_pct": 0.40,  # "all-play" luck-adjusted record (see compute_power_rankings)
    "win_pct": 0.30,        # season record
    "avg_points": 0.20,     # season scoring average, normalized against the field
    "recent_form": 0.10,    # blended recent win% + recent scoring, last 3 games (fewer early in the season)
}
ROLLING_WINDOW = 3

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
        print("See the docstring at the top of this script for how to get them.")
        sys.exit(1)
    with open(CREDENTIALS_PATH) as f:
        creds = json.load(f)
    if "paste-your" in creds.get("espn_s2", "") or "paste-your" in creds.get("swid", ""):
        print(f"ERROR: {CREDENTIALS_PATH} still has placeholder values - fill in your real cookies first.")
        sys.exit(1)
    return creds


def fetch_league_raw(league_id, season, views, creds):
    path = f"/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{league_id}"
    query = "&".join(f"view={v}" for v in views)
    url = f"{API_HOST}{path}?{query}"
    req = urllib.request.Request(url)
    req.add_header("Cookie", f"espn_s2={creds['espn_s2']}; SWID={creds['swid']}")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, context=SSL_CONTEXT) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 401:
            print("ERROR: 401 Unauthorized. Your espn_s2/SWID cookies are missing, wrong, or expired.")
            print("Re-fetch them from your browser (see this script's docstring) and try again.")
        else:
            print(f"ERROR: ESPN API returned {e.code}")
            print(e.read().decode(errors="replace")[:500])
        sys.exit(1)


def load_team_map():
    if not TEAM_MAP_PATH.exists():
        return {}
    with open(TEAM_MAP_PATH) as f:
        return json.load(f)


def cmd_map_teams(args, creds):
    data = fetch_league_raw(args.league_id, args.season, ["mTeam"], creds)
    teams = data.get("teams", [])
    print(f"\nFound {len(teams)} teams in league {args.league_id} ({args.season}):\n")
    existing = load_team_map()
    template = {}
    for t in teams:
        team_id = str(t["id"])
        name = f"{t.get('location', '')} {t.get('nickname', '')}".strip() or t.get("name", f"Team {team_id}")
        owner_hint = ""
        if t.get("owners"):
            owner_hint = f" (owner id: {t['owners'][0]})"
        print(f"  ESPN team {team_id}: \"{name}\"{owner_hint}")
        template[team_id] = existing.get(team_id, "FILL_IN_MANAGER_NAME")
    with open(TEAM_MAP_PATH, "w") as f:
        json.dump(template, f, indent=2)
    print(f"\nWrote {TEAM_MAP_PATH} - open it and replace FILL_IN_MANAGER_NAME with the")
    print("matching manager name from data/managers.json for each team, then re-run without --map-teams.")


def resolve_manager(team_id, team_map):
    name = team_map.get(str(team_id))
    if not name or name == "FILL_IN_MANAGER_NAME":
        return f"UNMAPPED_TEAM_{team_id}"
    return name


def _normalize(values):
    """Min-max scale a dict of {key: value} to {key: 0..1}. Flat fields (all equal) map to 0.5."""
    lo, hi = min(values.values()), max(values.values())
    if hi == lo:
        return {k: 0.5 for k in values}
    return {k: (v - lo) / (hi - lo) for k, v in values.items()}


def compute_power_rankings(schedule, week, team_map, prev_rankings):
    """
    Composite power score per manager, blending (see POWER_WEIGHTS):
      - win_pct: actual season record (ties = 0.5 win)
      - avg_points: season PPG, normalized against the field
      - expected_win_pct: "all-play" record - each week, a team's score is compared against
        every other team's score that same week (not just their real opponent). Beating a
        lower score = 1 expected win, tying = 0.5. This is the standard luck-adjusted record:
        a team with a great record but low expected wins has been winning close/lucky; a team
        with a poor record but high expected wins has just run into the league's best scores.
      - recent_form: win% + normalized PPG over the last ROLLING_WINDOW games (fewer early in
        the season), so a current hot streak can boost a team independent of their full-season
        record.
    Returns a list of {rank, manager, trend, blurb}, sorted best to worst.
    """
    played = [m for m in schedule if m.get("matchupPeriodId", 0) <= week and m.get("winner") not in (None, "UNDECIDED")]

    by_week = {}  # week -> [(manager, score), ...]
    results = {}  # manager -> [(week, own_score, win_fraction), ...] in week order
    for m in played:
        wk = m["matchupPeriodId"]
        home, away = m.get("home", {}), m.get("away", {})
        home_mgr = resolve_manager(home.get("teamId"), team_map)
        home_score = home.get("totalPoints", 0)
        by_week.setdefault(wk, []).append((home_mgr, home_score))
        results.setdefault(home_mgr, [])
        if away:
            away_mgr = resolve_manager(away.get("teamId"), team_map)
            away_score = away.get("totalPoints", 0)
            by_week.setdefault(wk, []).append((away_mgr, away_score))
            results.setdefault(away_mgr, [])
            if m["winner"] == "HOME":
                home_win, away_win = 1, 0
            elif m["winner"] == "AWAY":
                home_win, away_win = 0, 1
            else:
                home_win, away_win = 0.5, 0.5
            results[home_mgr].append((wk, home_score, home_win))
            results[away_mgr].append((wk, away_score, away_win))
        else:
            results[home_mgr].append((wk, home_score, 1))  # bye counts as a win, matches ESPN's own treatment

    managers = list(results.keys())
    if not managers:
        return []

    win_pct, avg_points, expected_win_pct, recent_form_raw = {}, {}, {}, {}
    for mgr in managers:
        games = results[mgr]
        games_played = len(games)
        win_pct[mgr] = sum(w for _, _, w in games) / games_played
        avg_points[mgr] = sum(s for _, s, _ in games) / games_played

        expected_wins = 0
        for wk, score, _ in games:
            field = by_week[wk]
            n_opp = len(field) - 1
            if n_opp <= 0:
                expected_wins += 1  # only team that played that week - can't compare, don't penalize
                continue
            beaten = sum(1 for m2, s2 in field if m2 != mgr and s2 < score)
            tied = sum(1 for m2, s2 in field if m2 != mgr and s2 == score)
            expected_wins += (beaten + 0.5 * tied) / n_opp
        expected_win_pct[mgr] = expected_wins / games_played

        recent = games[-ROLLING_WINDOW:]
        recent_win = sum(w for _, _, w in recent) / len(recent)
        recent_pts = sum(s for _, s, _ in recent) / len(recent)
        recent_form_raw[mgr] = {"win": recent_win, "pts": recent_pts}

    norm_avg_points = _normalize(avg_points)
    norm_recent_pts = _normalize({m: v["pts"] for m, v in recent_form_raw.items()})
    recent_form = {m: (recent_form_raw[m]["win"] + norm_recent_pts[m]) / 2 for m in managers}

    composite = {}
    for mgr in managers:
        composite[mgr] = (
            POWER_WEIGHTS["win_pct"] * win_pct[mgr]
            + POWER_WEIGHTS["avg_points"] * norm_avg_points[mgr]
            + POWER_WEIGHTS["expected_win_pct"] * expected_win_pct[mgr]
            + POWER_WEIGHTS["recent_form"] * recent_form[mgr]
        )

    ranked = sorted(managers, key=lambda m: composite[m], reverse=True)

    prev_rank_by_manager = {}
    if prev_rankings:
        for r in prev_rankings.get("rankings", []):
            prev_rank_by_manager[r["manager"]] = r["rank"]

    output = []
    for i, mgr in enumerate(ranked):
        rank = i + 1
        prev_rank = prev_rank_by_manager.get(mgr)
        if prev_rank is None:
            trend = "same"
        elif rank < prev_rank:
            trend = "up"
        elif rank > prev_rank:
            trend = "down"
        else:
            trend = "same"

        games_played = len(results[mgr])
        wins_actual = sum(w for _, _, w in results[mgr])
        blurb = (
            f"{wins_actual:g}-{games_played - wins_actual:g} actual "
            f"({expected_win_pct[mgr] * games_played:.1f} expected wins) &middot; "
            f"{avg_points[mgr]:.1f} PPG &middot; "
            f"last {len(results[mgr][-ROLLING_WINDOW:])}: {recent_form_raw[mgr]['win'] * len(results[mgr][-ROLLING_WINDOW:]):.1f}-"
            f"{(1 - recent_form_raw[mgr]['win']) * len(results[mgr][-ROLLING_WINDOW:]):.1f}, "
            f"{recent_form_raw[mgr]['pts']:.1f} PPG"
        )
        output.append({"rank": rank, "manager": mgr, "trend": trend, "blurb": blurb})

    return output


def cmd_fetch_week(args, creds):
    team_map = load_team_map()
    if not team_map:
        print("No scripts/espn_team_map.json found. Run with --map-teams first.")
        sys.exit(1)

    data = fetch_league_raw(args.league_id, args.season, ["mMatchupScore", "mTeam", "mScoreboard"], creds)

    week = args.week or data.get("scoringPeriodId")
    if not week:
        print("ERROR: could not auto-detect the current week, and none was given via --week.")
        sys.exit(1)

    teams_by_id = {t["id"]: t for t in data.get("teams", [])}

    # ---- Matchups ----
    matchups = []
    for m in data.get("schedule", []):
        if m.get("matchupPeriodId") != week:
            continue
        home = m.get("home", {})
        away = m.get("away", {})
        matchups.append({
            "home_manager": resolve_manager(home.get("teamId"), team_map),
            "home_score": home.get("totalPoints", 0),
            "away_manager": resolve_manager(away.get("teamId"), team_map) if away else None,
            "away_score": away.get("totalPoints", 0) if away else None,
            "winner": m.get("winner"),  # HOME / AWAY / UNDECIDED / TIE
        })

    matchups_path = SITE_DIR / "data" / "season_2026" / "matchups.json"
    all_matchups = _load_json_list(matchups_path)
    all_matchups = [w for w in all_matchups if w.get("week") != week]
    all_matchups.append({
        "week": week,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "games": matchups,
    })
    all_matchups.sort(key=lambda w: w["week"])
    _write_json(matchups_path, all_matchups)
    print(f"Wrote {len(matchups)} matchups for week {week} -> {matchups_path}")

    # ---- Standings ----
    standings = []
    for t in data.get("teams", []):
        record = t.get("record", {}).get("overall", {})
        standings.append({
            "manager": resolve_manager(t["id"], team_map),
            "wins": record.get("wins", 0),
            "losses": record.get("losses", 0),
            "ties": record.get("ties", 0),
            "points_for": round(record.get("pointsFor", 0), 1),
            "points_against": round(record.get("pointsAgainst", 0), 1),
            "streak_type": record.get("streakType"),
            "streak_length": record.get("streakLength"),
        })
    standings.sort(key=lambda s: (-s["wins"], -s["points_for"]))

    standings_path = SITE_DIR / "data" / "season_2026" / "standings.json"
    _write_json(standings_path, {
        "week": week,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "standings": standings,
    })
    print(f"Wrote standings as of week {week} -> {standings_path}")

    # ---- Power rankings (computed draft) / commentary stub (editorial - blurbs are factual,
    # never opinion; still requires Hunter's review before publishing) ----
    power_path = SITE_DIR / "data" / "season_2026" / "power_rankings.json"
    existing_power = _load_json_list(power_path)
    prior_weeks = [e for e in existing_power if e["week"] < week]
    prev_entry = max(prior_weeks, key=lambda e: e["week"]) if prior_weeks else None

    computed_rankings = compute_power_rankings(data.get("schedule", []), week, team_map, prev_entry)
    _ensure_stub(power_path, week, {
        "week": week,
        "published": False,
        "rankings": computed_rankings,
    })
    _ensure_stub(SITE_DIR / "data" / "season_2026" / "commentary.json", week, {
        "week": week,
        "published": False,
        "title": "",
        "body": "",
    })
    print("Power rankings are computed (see POWER_WEIGHTS at the top of this script to tune the "
          "methodology) and commentary is a blank stub - both are published: false until you "
          "review/edit them and flip that flag to true.")


def _load_json_list(path):
    if not path.exists():
        return []
    with open(path) as f:
        return json.load(f)


def _write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)


def _ensure_stub(path, week, stub):
    entries = _load_json_list(path)
    if any(e.get("week") == week for e in entries):
        return  # don't clobber an entry that's already being edited
    entries.append(stub)
    entries.sort(key=lambda e: e["week"])
    _write_json(path, entries)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--league-id", type=int, default=DEFAULT_LEAGUE_ID)
    parser.add_argument("--season", type=int, default=datetime.now().year)
    parser.add_argument("--week", type=int, default=None, help="Defaults to ESPN's current scoring period")
    parser.add_argument("--map-teams", action="store_true", help="Print/update the ESPN team ID -> manager mapping and exit")
    args = parser.parse_args()

    creds = load_credentials()
    if args.map_teams:
        cmd_map_teams(args, creds)
    else:
        cmd_fetch_week(args, creds)


if __name__ == "__main__":
    main()
