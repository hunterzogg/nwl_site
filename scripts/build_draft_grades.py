#!/usr/bin/env python3
"""
Builds data/draft_grades.json — grades every skill-position (QB/RB/WR/TE) draft
pick in data/draft_picks.json on how it turned out, using half-PPR fantasy
points from nflverse's public season stats (github.com/nflverse/nflverse-data).

Methodology:
  - "Position draft rank": the Nth player at that position taken in OUR
    league's draft that season, in overall-pick order (e.g. the 3rd WR
    taken is WR3), regardless of round or which manager took them.
  - "Position finish rank": that player's rank among all NFL players at that
    position by half-PPR points that season (half-PPR = standard fantasy
    points + 0.5 * receptions; nflverse ships both standard and full-PPR
    totals per week, so half-PPR = the average of the two).
  - diff = position_draft_rank - position_finish_rank. Positive means the
    player outperformed where we drafted them (good value); negative means
    they underperformed (bust). normalized_diff divides by that season's
    position pool size so positions with different pool sizes (e.g. TE vs
    WR) are comparable.
  - Players who were drafted but recorded no matching stat line that season
    (retired, hurt all year, never made a roster) are scored as the worst
    possible finish in that position's pool that year — a true bust.
  - No letter grades are computed here — this script ships raw ranks/diffs
    only. pages/draft.html blends normalized_diff ("value") with each pick's
    raw finish percentile ("production" — how good the season was regardless
    of draft slot, so e.g. an RB1 finishing RB3 still grades well) into a
    z-scored composite, then curves that into letter grades and manager
    rollups client-side, same convention as team_seasons/rankings.html.

Run: python3 scripts/build_draft_grades.py
Caches downloaded CSVs in scripts/.cache/ (gitignored) so re-runs are fast.
"""
import csv
import io
import json
import re
import ssl
import sys
import urllib.request
import certifi
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = Path(__file__).resolve().parent / '.cache'
CACHE_DIR.mkdir(exist_ok=True)

SEASONS = list(range(2013, 2026))
POSITION_GROUP = {'QB': 'QB', 'RB': 'RB', 'FB': 'RB', 'WR': 'WR', 'TE': 'TE'}
GRADED_POSITIONS = {'QB', 'RB', 'WR', 'TE'}

SSL_CTX = ssl.create_default_context(cafile=certifi.where())

# Known name variants where nflverse's display name doesn't match our
# league's spreadsheet-derived spelling. Keyed by normalized draft-sheet
# name -> normalized nflverse name.
NAME_ALIASES = {
    'gabe davis': 'gabriel davis',
    'gabriel davis': 'gabriel davis',
    'josh palmer': 'joshua palmer',
    'cadillac williams': 'carnell williams',
    'ted ginn': 'ted ginn',
    'steve smith': 'steve smith sr',
    'will fuller': 'william fuller v',
    'william fuller': 'william fuller v',
    'odell beckham': 'odell beckham jr',
    'marvin jones': 'marvin jones jr',
    'michael pittman': 'michael pittman jr',
    'allen robinson': 'allen robinson ii',
    'kenneth walker': 'kenneth walker iii',
    'melvin gordon': 'melvin gordon iii',
    'travis etienne': 'travis etienne jr',
    'pierre strong': 'pierre strong jr',
    'brian robinson': 'brian robinson jr',
    'walter powell': 'walter powell',
    'dj chark': 'dj chark jr',
    'd.j. chark': 'dj chark jr',
    'devante parker': 'devante parker',
    'duke johnson': 'duke johnson',
    'ronald jones': 'ronald jones ii',
    'todd gurley': 'todd gurley ii',
    'henry ruggs': 'henry ruggs iii',
    'terrace marshall': 'terrace marshall jr',
    'larry fitzgerald': 'larry fitzgerald',
    'robby anderson': 'robbie anderson',
    'robbie anderson': 'robbie anderson',
    'joshua dobbs': 'josh dobbs',
    'josh dobbs': 'josh dobbs',
    'irv smith': 'irv smith jr',
    'kj hamler': 'kj hamler',
    'k.j. hamler': 'kj hamler',
    'amonra st brown': 'amon-ra st brown',
    'de\'von achane': 'devon achane',
    'devon achane': 'devon achane',
    'wandale robinson': 'wan\'dale robinson',
    'michael vick': 'mike vick',
    'hollywood brown': 'marquise brown',
    'robbie anderson': 'robbie chosen',
    'robby anderson': 'robbie chosen',
    'chigoziem okonkwo': 'chig okonkwo',
    'stevie johnson': 'steve johnson',
    'charles johnson': 'charles d johnson',
}


def normalize_name(name):
    if not name:
        return ''
    n = name.lower().strip()
    n = n.replace('.', '').replace('\'', '').replace('-', ' ')
    n = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b', '', n)
    n = re.sub(r'\s+', ' ', n).strip()
    return NAME_ALIASES.get(n, n)


def fetch_csv(season):
    cache_path = CACHE_DIR / f'stats_player_week_{season}.csv'
    if cache_path.exists():
        return cache_path.read_text()
    url = f'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv'
    print(f'  downloading {url}', file=sys.stderr)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, context=SSL_CTX, timeout=60) as resp:
        text = resp.read().decode('utf-8')
    cache_path.write_text(text)
    return text


def build_season_leaderboards():
    """
    Returns (leaderboards, name_totals):
      leaderboards[season][group] = sorted list of (half_ppr, norm_name, display) —
        the ranked pool for that position that season, bucketed by each player's
        PRIMARY position that year (most weeks played at).
      name_totals[season][norm_name] = total half-PPR that player produced that
        season across ALL graded-position rows, regardless of which specific
        position each week was tagged — used as a fallback when a player's
        primary nflverse position differs from the position our league drafted
        them at (e.g. a WR nflverse mistags as TE, or a hybrid RB/WR).
    """
    leaderboards = {}
    name_totals = {}
    for season in SEASONS:
        text = fetch_csv(season)
        reader = csv.DictReader(io.StringIO(text))
        # per player: overall totals + per-position-tag week counts (to find primary position)
        totals = defaultdict(lambda: {'fp': 0.0, 'ppr': 0.0, 'display': '', 'pos_weeks': defaultdict(int)})
        for row in reader:
            if row.get('season_type') != 'REG':
                continue
            pos = row.get('position')
            group = POSITION_GROUP.get(pos)
            if not group:
                continue
            name = row.get('player_display_name') or row.get('player_name')
            if not name:
                continue
            norm_name = normalize_name(name)
            fp = float(row['fantasy_points']) if row.get('fantasy_points') else 0.0
            ppr = float(row['fantasy_points_ppr']) if row.get('fantasy_points_ppr') else 0.0
            t = totals[norm_name]
            t['fp'] += fp
            t['ppr'] += ppr
            t['display'] = name
            t['pos_weeks'][group] += 1

        by_group = defaultdict(list)
        season_name_totals = {}
        for norm_name, t in totals.items():
            half_ppr = (t['fp'] + t['ppr']) / 2
            season_name_totals[norm_name] = half_ppr
            primary_group = max(t['pos_weeks'].items(), key=lambda kv: kv[1])[0]
            by_group[primary_group].append((half_ppr, norm_name, t['display']))

        for group in by_group:
            by_group[group].sort(key=lambda x: -x[0])

        leaderboards[season] = by_group
        name_totals[season] = season_name_totals
        print(f'season {season}: ' + ', '.join(f'{g}={len(v)}' for g, v in by_group.items()), file=sys.stderr)
    return leaderboards, name_totals


def main():
    print('Building season half-PPR leaderboards from nflverse...', file=sys.stderr)
    leaderboards, name_totals = build_season_leaderboards()

    # rank + lookup index per season/position_group (primary-position matches only)
    rank_index = {}  # (season, group, norm_name) -> (rank, half_ppr)
    pool_size = {}    # (season, group) -> count
    sorted_values = {}  # (season, group) -> sorted list of half_ppr values, for fallback ranking
    for season, by_group in leaderboards.items():
        for group, rows in by_group.items():
            pool_size[(season, group)] = len(rows)
            sorted_values[(season, group)] = [r[0] for r in rows]
            for i, (half_ppr, norm_name, display) in enumerate(rows):
                rank_index[(season, group, norm_name)] = (i + 1, round(half_ppr, 2))

    def lookup(season, group, norm_name):
        """Returns (finish_rank, half_ppr, matched, cross_position) or None if truly no data."""
        direct = rank_index.get((season, group, norm_name))
        if direct:
            return direct[0], direct[1], True, False
        # fallback: player has stats that season, just tagged under a different
        # primary position by nflverse (e.g. hybrid usage or a tagging quirk) —
        # rank them into the TARGET position's pool using their season total.
        total = name_totals.get(season, {}).get(norm_name)
        if total is not None:
            values = sorted_values.get((season, group), [])
            rank = sum(1 for v in values if v > total) + 1
            return rank, round(total, 2), True, True
        return None

    with open(ROOT / 'data' / 'draft_picks.json') as f:
        picks = json.load(f)

    # position draft rank: order picks within each season by overall_pick,
    # counting occurrences per position as we go (league-wide, not per-manager)
    picks_by_season = defaultdict(list)
    for p in picks:
        if p['position'] not in GRADED_POSITIONS:
            continue
        picks_by_season[int(p['season'])].append(p)

    graded = []
    unmatched = []
    for season, season_picks in picks_by_season.items():
        season_picks.sort(key=lambda p: int(p['overall_pick']))
        pos_counter = defaultdict(int)
        for p in season_picks:
            pos = p['position']
            pos_counter[pos] += 1
            draft_rank = pos_counter[pos]

            norm_name = normalize_name(p['player'])
            pool = pool_size.get((season, pos), 0)

            found = lookup(season, pos, norm_name)
            if found:
                finish_rank, half_ppr, matched, cross_position = found
            else:
                finish_rank = pool + 1
                half_ppr = 0.0
                matched = False
                unmatched.append({'season': season, 'manager': p['manager'], 'player': p['player'], 'position': pos})

            diff = draft_rank - finish_rank
            normalized_diff = diff / pool if pool else 0.0

            graded.append({
                'season': season,
                'manager': p['manager'],
                'player': p['player'],
                'position': pos,
                'round': int(p['round']),
                'overall_pick': int(p['overall_pick']),
                'position_draft_rank': draft_rank,
                'position_finish_rank': finish_rank,
                'position_pool_size': pool,
                'half_ppr_points': half_ppr,
                'diff': diff,
                'normalized_diff': round(normalized_diff, 4),
                'matched': matched,
            })

    graded.sort(key=lambda r: (r['season'], r['overall_pick']))

    out_path = ROOT / 'data' / 'draft_grades.json'
    with open(out_path, 'w') as f:
        json.dump(graded, f, indent=None, separators=(',', ':'))

    print(f'\nWrote {len(graded)} graded picks to {out_path}', file=sys.stderr)
    print(f'Unmatched (scored as full bust, no stat line found): {len(unmatched)} / {len(graded)} '
          f'({100*len(unmatched)/len(graded):.1f}%)', file=sys.stderr)

    unmatched_path = CACHE_DIR / 'unmatched.json'
    with open(unmatched_path, 'w') as f:
        json.dump(unmatched, f, indent=2)
    print(f'Unmatched list written to {unmatched_path} for review', file=sys.stderr)


if __name__ == '__main__':
    main()
