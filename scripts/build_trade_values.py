#!/usr/bin/env python3
"""
Builds data/season_2026/trade_values.json for pages/trade-tools.html (the Trade Calculator).

Replaces the old fetch_espn_rosters.py / rosters.json pipeline (scrapped in the October 2026
rebuild). Everything the calculator needs in one file:

  1. League context (ESPN, authenticated with scripts/espn_credentials.json):
     - every team's current roster (mRoster) with ESPN's rest-of-season projection per player
       (statSourceId 1, scoringPeriodId 0, statSplitTypeId 0: appliedTotal = remaining points,
       appliedAverage = per game) and this week's projection
     - the top available free agents (kona_player_info, FREEAGENT + WAIVERS) with the same fields
     - lineup slots (mSettings lineupSlotCounts) and the regular-season schedule length
     - standings (records) and each team's 2026 weekly scores, for the matchup spread used to turn
       points per week into expected wins
  2. Redraft market values, one entry per source, so the page can show how each market grades a
     trade (all on a ~0-10,000 scale):
     - fantasycalc:  FantasyCalc redraft values, half PPR, 12-team 1QB (public API, matched by ESPN id)
     - ktc:          KeepTradeCut redraft rankings, 1QB (fantasy-rankings page; matched via MFL id)
     - fantasypros:  FantasyPros rest-of-season ECR, half PPR (rankings page; matched by name+position)
     - espn / fanduel / fantasyguys: rest-of-season positional ranks from Dynasty Daddy's public
       player feed (dynasty-daddy.com/api/v1/player/all/today), which also supplies the ESPN<->MFL
       id crosswalk
     Rank-only sources are converted to values with FantasyCalc's own curve: positional rank N is
     worth whatever FantasyCalc's Nth-best player at that position is worth (extrapolated past the
     end of FantasyCalc's list). A source that fails to load is simply left out; the page grades
     with whatever sources are present.
  3. market: the consensus value per player = weighted median of the source values (FantasyPros counts
     double). A source that doesn't list a player counts him just past the end of its list at his position.
  4. ranks: each player's raw rest-of-season positional ranks per rank source (fantasypros, espn,
     fanduel, fantasyguys); the page shows their median as the player's ROS rank.

Head Coaches (ESPN slot 19) are included for lineups but have no market values (no source lists them).

Usage:  python3 scripts/build_trade_values.py
"""
import json
import math
import re
import ssl
import statistics
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SITE_DIR = SCRIPT_DIR.parent
CREDENTIALS_PATH = SCRIPT_DIR / "espn_credentials.json"
TEAM_MAP_PATH = SCRIPT_DIR / "espn_team_map.json"
MATCHUPS_PATH = SITE_DIR / "data" / "season_2026" / "matchups.json"
OUTPUT_PATH = SITE_DIR / "data" / "season_2026" / "trade_values.json"

LEAGUE_ID = 39276
SEASON = 2026
API = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{SEASON}/segments/0/leagues/{LEAGUE_ID}"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"

POS = {1: "QB", 2: "RB", 3: "WR", 4: "TE"}
HC_SLOT, BENCH_SLOT, IR_SLOT = 19, 20, 21
PRO_TEAM = {1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB",
            10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO",
            19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB",
            28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU"}
FREE_AGENT_POOL = 300  # top available players by % owned
# FantasyPros ECR (a multi-expert consensus) counts double in the consensus value and the ROS rank.
SOURCE_WEIGHT = {"fantasypros": 2}


def weighted_median(pairs):
    """pairs: [(value, weight)] -> weighted median (averages the two middle values on an exact tie)."""
    pairs = sorted(pairs)
    total = sum(w for _, w in pairs)
    acc = 0
    for i, (v, w) in enumerate(pairs):
        acc += w
        if acc * 2 > total:
            return v
        if acc * 2 == total:
            return (v + pairs[i + 1][0]) / 2
    return pairs[-1][0]

try:
    import certifi
    SSL = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL = ssl.create_default_context()


def get(url, headers=None, raw=False, timeout=40):
    hdrs = {"User-Agent": UA, "Accept": "application/json,text/html", **(headers or {})}
    try:
        req = urllib.request.Request(url, headers=hdrs)
        with urllib.request.urlopen(req, timeout=timeout, context=SSL) as r:
            body = r.read()
    except urllib.error.URLError as e:
        if isinstance(e, urllib.error.HTTPError):
            raise
        # Older local Pythons can't negotiate some sites' TLS (KeepTradeCut); curl uses the system stack.
        cmd = ["curl", "-sfL", "--max-time", str(timeout), url] + sum((["-H", f"{k}: {v}"] for k, v in hdrs.items()), [])
        body = subprocess.run(cmd, capture_output=True, check=True).stdout
    return body.decode("utf-8", "replace") if raw else json.loads(body)


def espn(view_qs, cookies, extra=None):
    try:
        return get(f"{API}?{view_qs}", {"Cookie": cookies, **(extra or {})})
    except urllib.error.HTTPError as e:
        if e.code == 401:
            sys.exit("ERROR: ESPN returned 401 - espn_credentials.json cookies are missing or expired "
                     "(see fetch_espn_week.py's docstring for how to refresh them).")
        raise


def norm_name(name):
    n = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    n = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", n)
    return re.sub(r"[^a-z]", "", n)


def projections(player, season):
    """(rest-of-season points, rest-of-season per game, this week's projection) from ESPN stats."""
    ros_total = ros_pg = 0.0
    for s in player.get("stats") or []:
        if s.get("seasonId") == season and s.get("statSourceId") == 1 and s.get("scoringPeriodId") == 0 \
                and s.get("statSplitTypeId") == 0:
            ros_total, ros_pg = s.get("appliedTotal") or 0.0, s.get("appliedAverage") or 0.0
    return round(ros_total, 1), round(ros_pg, 2)


def week_projection(player, season, week):
    for s in player.get("stats") or []:
        if s.get("seasonId") == season and s.get("statSourceId") == 1 and s.get("scoringPeriodId") == week \
                and s.get("statSplitTypeId") == 1:
            return round(s.get("appliedTotal") or 0.0, 2)
    return 0.0


def pos_of(player, slot=None):
    if player.get("id", 0) < 0 or slot == HC_SLOT:
        return "HC"
    p = POS.get(player.get("defaultPositionId"))
    if p is None and HC_SLOT in (player.get("eligibleSlots") or []):
        return "HC"
    return p


def player_row(pl, week):
    pos = pos_of(pl)
    ros_total, ros_pg = projections(pl, SEASON)
    return {"id": str(pl["id"]), "name": pl["fullName"], "pos": pos, "team": PRO_TEAM.get(pl.get("proTeamId"), "FA"),
            "inj": pl.get("injuryStatus") if pl.get("injuryStatus") not in (None, "ACTIVE", "NORMAL") else None,
            "ros": ros_total, "ros_pg": ros_pg, "wk": week_projection(pl, SEASON, week),
            "own": round((pl.get("ownership") or {}).get("percentOwned") or 0, 1)}


# ---------------- market sources ----------------

def src_fantasycalc():
    rows = get("https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=0.5")
    return {"by_espn": {str(r["player"]["espnId"]): r["value"] for r in rows if r["player"].get("espnId")},
            "by_pos": {p: sorted((r["value"] for r in rows if r["player"].get("position") == p), reverse=True)
                       for p in ("QB", "RB", "WR", "TE")}}


def src_ktc():
    html = get("https://keeptradecut.com/fantasy-rankings?filters=QB|WR|RB|TE&format=1", raw=True)
    m = re.search(r'<script[^>]*id="ktc-players"[^>]*>(.*?)</script>', html, re.S)
    players = json.loads(m.group(1))
    return [{"name": p["playerName"], "pos": p["position"], "mfl": str(p.get("mflid") or ""),
             "value": (p.get("oneQBValues") or {}).get("value")} for p in players]


def src_fantasypros():
    html = get("https://www.fantasypros.com/nfl/rankings/ros-half-point-ppr-overall.php", raw=True)
    m = re.search(r"var ecrData = (\{.*?\});\s*\n", html, re.S)
    data = json.loads(m.group(1))
    out = []
    for p in data["players"]:
        if p["player_position_id"] in ("QB", "RB", "WR", "TE"):
            out.append({"name": p["player_name"], "pos": p["player_position_id"],
                        "pos_rank": int(re.sub(r"\D", "", p["pos_rank"]) or 0)})
    return out, data.get("total_experts")


def src_dynasty_daddy():
    return get("https://dynasty-daddy.com/api/v1/player/all/today", timeout=60)


def rank_to_value(fc_by_pos, pos, rank):
    """FantasyCalc's value for the Nth-best player at this position; exponential tail past its list."""
    curve = fc_by_pos.get(pos) or []
    if not curve or not rank or rank < 1:
        return None
    if rank <= len(curve):
        return curve[rank - 1]
    tail = curve[-1]
    decay = math.log(curve[max(0, len(curve) - 6)] / tail) / 5 if len(curve) > 6 and tail > 0 else 0.08
    return round(tail * math.exp(-max(decay, 0.03) * (rank - len(curve))))


def main():
    creds = json.loads(CREDENTIALS_PATH.read_text())
    cookies = f"espn_s2={creds['espn_s2']}; SWID={creds['swid']}"
    team_map = json.loads(TEAM_MAP_PATH.read_text())

    base = espn("view=mSettings&view=mTeam&view=mStatus", cookies)
    week = base["scoringPeriodId"]
    st = base["settings"]
    slots = {int(k): v for k, v in st["rosterSettings"]["lineupSlotCounts"].items() if v}
    reg_weeks = st["scheduleSettings"]["matchupPeriodCount"]
    roster_size = sum(v for k, v in slots.items() if k != IR_SLOT)

    players, teams = {}, []
    roster = espn(f"view=mRoster&scoringPeriodId={week}", cookies)
    for t in roster["teams"]:
        meta = next(x for x in base["teams"] if x["id"] == t["id"])
        active, ir = [], []
        for e in t["roster"]["entries"]:
            pl = e["playerPoolEntry"]["player"]
            if not pos_of(pl, e["lineupSlotId"]):
                continue
            row = player_row(pl, week)
            if e["lineupSlotId"] == HC_SLOT:
                row["pos"] = "HC"
            players[row["id"]] = row
            (ir if e["lineupSlotId"] == IR_SLOT else active).append(row["id"])
        rec = meta.get("record", {}).get("overall", {})
        teams.append({"id": t["id"], "manager": team_map.get(str(t["id"]), f"Team {t['id']}"),
                      "w": rec.get("wins", 0), "l": rec.get("losses", 0), "t": rec.get("ties", 0),
                      "pf": round(rec.get("pointsFor", 0), 1), "players": active, "ir": ir})

    flt = {"players": {"filterStatus": {"value": ["FREEAGENT", "WAIVERS"]},
                       "filterSlotIds": {"value": [0, 2, 4, 6, HC_SLOT]}, "limit": FREE_AGENT_POOL,
                       "sortPercOwned": {"sortPriority": 1, "sortAsc": False}}}
    fa_ids = []
    for p in espn(f"view=kona_player_info&scoringPeriodId={week}", cookies, {"x-fantasy-filter": json.dumps(flt)})["players"]:
        pl = p["player"]
        if not pos_of(pl):
            continue
        row = player_row(pl, week)
        players[row["id"]] = row
        fa_ids.append(row["id"])

    # ---- market sources ----
    sources, notes = {}, {}
    ranks = {}  # espnId -> {source: rest-of-season positional rank}
    max_rank = {}   # rank source -> {pos: deepest rank it lists}
    min_value = {}  # value source -> {pos: lowest value it lists}
    fc = None
    try:
        fc = src_fantasycalc()
        sources["fantasycalc"] = {pid: fc["by_espn"][pid] for pid in players if pid in fc["by_espn"]}
        min_value["fantasycalc"] = {pos: v[-1] for pos, v in fc["by_pos"].items() if v}
    except Exception as e:  # noqa: BLE001 - a missing source just drops out of the verdicts
        notes["fantasycalc"] = f"failed: {e}"
    dd = []
    try:
        dd = src_dynasty_daddy()
    except Exception as e:  # noqa: BLE001
        notes["dynasty_daddy"] = f"failed: {e}"
    mfl_to_espn = {str(x["mfl_id"]): str(x["espn_id"]) for x in dd if x.get("mfl_id") and x.get("espn_id")}
    name_to_espn = {}
    for pid, p in players.items():
        if p["pos"] != "HC":
            name_to_espn.setdefault((norm_name(p["name"]), p["pos"]), pid)
    for x in dd:
        if x.get("espn_id"):
            name_to_espn.setdefault((norm_name(x["full_name"]), x["position"]), str(x["espn_id"]))

    def match(name, pos, mfl=None):
        if mfl and mfl in mfl_to_espn:
            return mfl_to_espn[mfl]
        return name_to_espn.get((norm_name(name), pos))

    try:
        ktc = src_ktc()
        sources["ktc"] = {}
        min_value["ktc"] = {}
        for p in ktc:
            if p["value"] and p["pos"] in ("QB", "RB", "WR", "TE"):
                min_value["ktc"][p["pos"]] = min(min_value["ktc"].get(p["pos"], 10 ** 9), p["value"])
            pid = match(p["name"], p["pos"], p["mfl"])
            if pid in players and p["value"]:
                sources["ktc"][pid] = p["value"]
    except Exception as e:  # noqa: BLE001
        notes["ktc"] = f"failed: {e}"

    if fc:
        try:
            fp, experts = src_fantasypros()
            sources["fantasypros"] = {}
            max_rank["fantasypros"] = {}
            for p in fp:
                max_rank["fantasypros"][p["pos"]] = max(max_rank["fantasypros"].get(p["pos"], 0), p["pos_rank"])
                pid = match(p["name"], p["pos"])
                if pid in players:
                    sources["fantasypros"][pid] = rank_to_value(fc["by_pos"], p["pos"], p["pos_rank"])
                    if p["pos_rank"]:
                        ranks.setdefault(pid, {})["fantasypros"] = p["pos_rank"]
            notes["fantasypros"] = f"{experts} experts"
        except Exception as e:  # noqa: BLE001
            notes["fantasypros"] = f"failed: {e}"
        for key, label in (("espn_ros", "espn"), ("fanduel_ros", "fanduel"), ("fantasyguys_ros", "fantasyguys")):
            vals = {}
            max_rank[label] = {}
            for x in dd:
                if x.get(key) and x.get("position") in ("QB", "RB", "WR", "TE"):
                    max_rank[label][x["position"]] = max(max_rank[label].get(x["position"], 0), int(x[key]))
                pid = str(x.get("espn_id") or "")
                if pid in players and x.get(key):
                    vals[pid] = rank_to_value(fc["by_pos"], x["position"], int(x[key]))
                    ranks.setdefault(pid, {})[label] = int(x[key])
            if vals:
                sources[label] = vals

    # A source that leaves a player out isn't neutral: it didn't think he was worth listing. So a missing
    # player counts as just past the end of that source's list at his position: rank sources -> one spot
    # below their deepest ranked player (converted like any other rank), value sources -> 80% of their
    # lowest listed value. Imputed ranks are recorded in `unranked` so the page can say so.
    unranked = {}
    for pid, p in players.items():
        if p["pos"] not in ("QB", "RB", "WR", "TE"):
            continue
        for src, vals in sources.items():
            if vals.get(pid):
                continue
            if src in max_rank and max_rank[src].get(p["pos"]):
                r = max_rank[src][p["pos"]] + 1
                vals[pid] = rank_to_value(fc["by_pos"], p["pos"], r) if fc else None
                ranks.setdefault(pid, {})[src] = r
                unranked.setdefault(pid, []).append(src)
            elif src in min_value and min_value[src].get(p["pos"]):
                vals[pid] = round(min_value[src][p["pos"]] * 0.8)

    # Consensus = weighted median, FantasyPros ECR counting double (SOURCE_WEIGHT).
    market = {}
    for pid, p in players.items():
        pairs = [(s[pid], SOURCE_WEIGHT.get(k, 1)) for k, s in sources.items() if s.get(pid)]
        if pairs:
            market[pid] = round(weighted_median(pairs))

    # ---- weekly score spread, for points/week -> expected wins ----
    sd_team = 25.0
    try:
        mu = json.loads(MATCHUPS_PATH.read_text())
        scores = [g[k] for w in mu for g in w["games"] if g["winner"] not in (None, "UNDECIDED")
                  for k in ("home_score", "away_score")]
        if len(scores) > 20:
            sd_team = round(statistics.pstdev(scores), 1)
    except Exception:  # noqa: BLE001
        pass

    out = {
        "season": SEASON, "week": week, "updated_at": datetime.now(timezone.utc).isoformat(),
        "regular_season_weeks": reg_weeks,
        "games_remaining": max(0, reg_weeks - week + 1),
        "roster_size": roster_size,
        "slots": {str(k): v for k, v in slots.items() if k not in (BENCH_SLOT, IR_SLOT)},
        "score_sd": sd_team,
        "teams": teams, "free_agents": fa_ids, "players": players,
        "sources": sources, "source_notes": notes, "market": market, "ranks": ranks, "unranked": unranked,
        "source_weights": SOURCE_WEIGHT,
    }
    OUTPUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    counts = ", ".join(f"{k} {len(v)}" for k, v in sources.items())
    print(f"Wrote {OUTPUT_PATH} - week {week}, {len(teams)} teams, {len(fa_ids)} free agents, "
          f"{len(market)} players with market values ({counts}); score sd {sd_team}")
    for k, v in notes.items():
        if v.startswith("failed"):
            print(f"  WARNING: {k} {v}")


if __name__ == "__main__":
    main()
