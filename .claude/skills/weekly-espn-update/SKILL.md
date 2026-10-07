---
name: weekly-espn-update
description: Pull this week's NWL fantasy football matchups, standings, power rankings, and current rosters/trade values from ESPN into data/season_2026/*.json, then walk through reviewing and publishing the results (including commentary and Brian's Fun Facts), grading last week's Pick'em props, and drafting next week's. Use this whenever the user asks to update the site with this week's scores/matchups/standings/rosters, mentions running the weekly ESPN pull, says something like "pull this week's data" or "update the 2026 hub" or "refresh rosters" or "update the weekly pick'em" or "grade last week's picks" or "create next week's props" or "update Brian's Fun Facts", or wants to publish power rankings/commentary for the current NWL season. Applies during the NWL season (roughly September through year-end) whenever real ESPN data needs to land on the site. Note: the data-pull half also runs automatically on a schedule via .github/workflows/weekly-espn-update.yml — this skill is for an on-demand/manual run (e.g. the user wants fresher data right now, is troubleshooting, or wants Pick'em grading/props/Fun Facts handled, which the automated workflow never does).
---

# Weekly ESPN update

Runs the NWL site's weekly data pull from ESPN and walks through publishing it (matchups,
standings, power rankings, commentary, and Brian's Fun Facts), grading last week's Pick'em props,
and drafting the next week's. Three parts:

1. **Data pull + editorial review** - a thin wrapper around `scripts/fetch_espn_week.py`
   (matchups/standings/power rankings/commentary) and `scripts/fetch_espn_rosters.py` (current
   rosters + trade values, for Trade Tools) - the scripts do the actual work; this skill's job is
   to run them correctly, help review what they produced, and not skip the manual publish step for
   the editorial pieces (power rankings, commentary, and Brian's Fun Facts - the last of which no
   script writes at all, see "After running" below). A scheduled GitHub Action
   (`.github/workflows/weekly-espn-update.yml`) already runs both scripts automatically several
   times a week during the season and auto-commits matchups/standings/rosters (the facts) while
   still leaving power rankings/commentary unpublished for review - use this skill when the user
   wants a fresher pull right now rather than waiting for the next scheduled run, is
   troubleshooting a failed run, or wants Pick'em grading/props or Fun Facts handled (which the
   automated workflow never does - see parts 2 and 3, and "After running" for Fun Facts).
2. **Grade last week's props** - once that week's games are fully final, compute and write
   `correct_option` for whatever's gradable from real site data (see "Grading last week's Pick'em
   props" below). **Show the computed grades before writing them** - same sign-off requirement as
   drafting, just because a grade is "objective" doesn't mean a misread stat can't happen.
3. **Draft next week's props** - once real data exists for the upcoming week's matchups, draft
   that week's weekly Pick'em props grounded in it (see "Weekly Pick'em props" below). **Never
   publish these without the user's explicit sign-off** - draft, insert unpublished, show the
   user, wait for a real yes, only then flip live.

## Before running

Credentials (`scripts/espn_credentials.json`) and the team ID → manager map
(`scripts/espn_team_map.json`) are already set up and gitignored — don't ask the user to redo
setup unless the script itself reports a 401 (expired cookies) or missing/unmapped teams. If it
does, point the user at the docstring in `scripts/fetch_espn_week.py` for how to refresh cookies
via browser DevTools; don't try to fetch or guess credentials yourself.

## Run the pull

From the repo root:

```bash
python3 scripts/fetch_espn_week.py
python3 scripts/fetch_espn_rosters.py
```

No `--week` needed in the normal case — `fetch_espn_week.py` auto-detects ESPN's current scoring
period. Only pass `--week N` explicitly if the user asks for a specific past/future week (e.g.
backfilling a missed week, or pre-loading a schedule week before it's played). Both scripts are
safe to re-run any time — `fetch_espn_week.py` overwrites that week's entry rather than
duplicating it (fine to re-run later in the day to catch a score correction), and
`fetch_espn_rosters.py` just overwrites the whole file with a fresh snapshot every time (run it
whenever the user wants current trade values, e.g. after a waiver period). Run
`fetch_espn_week.py` first if both are needed — `fetch_espn_rosters.py` reads the just-written
`standings.json` for each team's division.

This writes/updates five files under `data/season_2026/`:

- `matchups.json` — that week's games and scores (factual, no review needed)
- `standings.json` — current W-L/points standings (factual, no review needed)
- `power_rankings.json` — a computed ranking draft for the week, `published: false`
- `commentary.json` — a blank stub (`title`/`body` empty), `published: false`
- `rosters.json` — current rosters + trade values for Trade Tools (factual, no review needed)

## After running — walk through publishing

Matchups and standings are pure facts pulled straight from ESPN — they don't need review, and
just having run the script is enough for those two files. Power rankings, commentary, and Brian's
Fun Facts are the editorial layer and are deliberately never auto-published, so always do the
following instead of treating the script's success as "done":

**Week-numbering convention (standardized from Week 4 on):** the regular update runs on
**Tuesday**, after Monday night's games are final. Every editorial section (power rankings,
commentary, Fun Facts) is labeled with the **upcoming** week number and **looks back** at the week
just played. For example, the Tuesday before Week 4 publishes Week 4's power rankings, commentary,
and Fun Facts, and all three recap Week 3's results, with an optional short preview of the Week 4
matchups at the end. This lines up with the script: on a Tuesday, ESPN's current scoring period is
already the upcoming week, so the `power_rankings.json` entry and the `commentary.json` stub it
writes carry that number. Put the recap in that stub, not in the just-finished week's entry. Weeks
1-2 were published before this convention and each recaps its own week; leave them as they are.

1. **Show the user what changed.** Summarize the week's matchup results and standings movement
   briefly in chat so they don't have to open the JSON themselves.
2. **Check `power_rankings.json` for EVERY unpublished entry, not just the current week's.** A
   week can slip through unpublished if a prior session pulled fresh data but nobody walked
   through this review step before moving on - real example: Week 3's entry sat unpublished with
   full, correct data for several days because a session graded that week's Pick'em props but
   never separately reviewed its power rankings. `rank`/`trend`/`delta`/`rank_streak`/`sos_rank`
   all auto-chain correctly off whatever the most recent prior entry is (published or not) each
   time the script runs, so there's no need to manually recompute anything week over week - that
   was only ever a one-time backfill fix for entries computed before those fields existed (see
   the "Power rankings restyled..." and "'Same' rank now shows..." entries in HANDOFF.md). Surface
   every unpublished week's rankings for review; if a week has too few played games to rank anyone
   yet (e.g. week 1 before kickoff), say so plainly rather than presenting an empty list as a
   problem.
3. **Draft commentary** for the upcoming week's stub (recapping the week just played, per the
   convention above). The `commentary.json` stub ships with empty `title`/`body`. Tone is a
   **funny recap grounded in league history**: roast bad lineup calls, celebrate lucky wins, and tie
   each storyline to a real historical comparison (e.g. "first back-to-back 3-0 start in NWL
   history", "16 of 17 prior 3-0 teams made the playoffs"). For player-level detail (who scored
   what, who was left on the bench), pull that week's box scores with a read-only ESPN call:
   `view=mMatchupScore&view=mBoxscore&scoringPeriodId=<played week>`, using `fetch_league_raw`'s
   cookie pattern in `scripts/fetch_espn_week.py`. Each team's
   `rosterForCurrentScoringPeriod.entries[]` has `lineupSlotId` (20 = bench, 21 = IR) and
   `playerPoolEntry.appliedStatTotal`. Bench-vs-starter swaps that would have flipped a result are
   reliably the best material. The jokes can be opinionated, but every number and "first/most ever"
   claim has to come from real data. Don't infer why a player scored 0.0 (bye vs. injury) without
   checking. Use they/them for managers. Always draft it, show it, and leave it unpublished for
   review.
   **Add visuals where they help** (tables and bar charts, not decoration): a commentary entry can
   carry an optional `visuals` array, each placed in `body` by a paragraph that is exactly
   `{{visual:<id>}}`. Two types, rendered by `commentaryVisualHTML()` in `pages/season-2026.html`:
   `table` (`columns: [{key, label, num?, manager?}]`, `rows: [{...cells, _hl?, _em?: [keys]}]`) and
   `bar` (`bars: [{manager?, label, value, display?, tone?: 'hot'|'muted'}]`, optional `legend`). Week
   5 is the worked example: Week 4 scores bar chart, all-time points-against bars, a wrong-QB table,
   and the best-ball table. Let the visual carry the numbers and keep the prose around it short.
   **Best-ball standings** are a standing section: every team and every opponent plays its
   highest-scoring legal lineup from that week's roster (slots QB, 2 RB, 2 WR, WR/TE, TE, HC, FLEX
   per ESPN `lineupSlotCounts`; IR excluded; use each player's `eligibleSlots`), compared with actual
   records plus season bench points left, as a table with flipped records highlighted.
4. **Draft "Brian's Fun Facts"** for the upcoming week (same look-back convention). Unlike commentary, no script writes
   `data/season_2026/fun_facts.json` at all, so there's no stub waiting; append a new entry by hand
   (`{"week": N, "published": false, "facts": [...]}`, one array entry per week - see the existing
   week 2 entry for the shape). Each fact is `{label, headline, num, sub, tone, wide}` - `headline`
   uses a literal `{{num}}` placeholder the front end swaps for a styled `<span>` (e.g. `"headline":
   "{{num}} — Ainsworth"`, `"num": "165.56"`), `tone` is `hot`/`cold`/`green`/`red`/`""` (colors the
   number), `wide: true` spans both grid columns. Ground every fact in real data the same way the
   Week 4 Pick'em props were (this week's matchups.json, recent-weeks trends, and real league
   history from the data files - see "Weekly Pick'em props" below for where that history lives) -
   never invent a stat. 8-10 facts is a reasonable batch size (see the week 2 and week 4
   entries; week 4 is the first under the look-back convention and shows the usual mix: high/low
   score, nailbiter, costliest bench decision, historical-start odds, and a "Game of the Week" card
   with the all-time head-to-head for the upcoming week). `matchup_results.json` was rebuilt from
   ESPN's real schedules in late September 2026. It has exact decimal scores and correct pairings
   for every season back to 2013, so records, streaks, "N-0 starts", points against, and
   head-to-head can be computed from it directly. Before that rebuild, most pre-2023 pairings were
   reconstructed, and a wrong one produced a false claim (Larson "3-0 in 2022"). If a history claim
   ever looks surprising, spot-check it against ESPN:
   `.../seasons/<year>/segments/0/leagues/39276?view=mMatchupScore&view=mTeam` works back to 2013.
   Its team IDs changed hands over the years, so map them per season by matching scores against
   `weekly_scores.json`. Watch out for ties: the 4 real ties (2013-14) are stored with the home team
   as `winner`, so check `winning_score == losing_score` before calling one a win. Other history notes: "Made the playoffs" means `final_finish` ≤ 6 in
   `team_seasons_regular.json`, and "current scoring era" means 2022 onward.
5. **Flip `published: true`** on every power rankings, commentary, and Fun Facts entry the user
   has actually reviewed/approved (could be more than one week at once, per point 2 above) — never
   do this automatically as part of running the script. Edit the JSON directly (find the matching
   entry, set `"published": false` → `"published": true`).
6. **Remind the user that nothing here touches git.** The data files are now updated locally, but
   the live site (GitHub Pages + Vercel) won't see any of it until it's committed and pushed:
   ```bash
   git add -A
   git commit -m "Update week N data: matchups, standings, power rankings, commentary, fun facts, rosters"
   git push
   ```
   Per this project's standing rule, always ask before running `git push` — don't assume a prior
   approval carries forward to this week's push.

## Grading last week's Pick'em props

Once a week's games are all final (check `matchups.json` for that week - no game should still
show `"winner": "UNDECIDED"`), grade whatever questions from that week are gradable from real site
data. Same rule as everywhere else in Pick'em: Claude never types the `ADMIN_PASSCODE`, so grading
is a direct Postgres write via `.env.local` + `node`, not a trip through `pickem-admin.html`.

1. **Find what needs grading**:
   ```bash
   cd ~/Sites/nwl_site
   export $(grep -v '^#' .env.local | xargs)
   node -e "
   const { sql } = require('./api/lib/db');
   (async () => {
     const q = await sql\`SELECT id, type, prompt, option_a, option_b FROM questions WHERE week = <N> AND correct_option IS NULL AND published = true\`;
     console.log(JSON.stringify(q.rows, null, 2));
     process.exit(0);
   })();
   "
   ```
2. **Compute the real answer for each, from `matchups.json`/`standings.json` for that week** - the
   same data already on the site, not a fresh guess:
   - `over_under`/`this_or_that` tied to a score, margin, or spread (e.g. "highest individual
     score," "will X cover the spread") - read the actual final scores for that week and compare
     against the line. `correct_option` is `'a'` or `'b'`.
   - `pick_manager` (e.g. "most points this week") - whoever's real score/stat for that week wins;
     `correct_option` is their manager name (not `'a'`/`'b'`).
   - `number_guess` - `correct_option` is the real number; the leaderboard grades it correct within
     ±2 automatically (see `CORRECT_CASE` in `api/leaderboard.js`), no special handling needed here.
   - **Some props can't be graded from site data at all** - anything asking about a real-world
     event the site doesn't track (e.g. a manager's own lineup decision, something off-platform).
     Don't guess or leave these silently ungraded without saying so - flag them by name and ask the
     user directly, since only they'd know the real answer.
3. **Show the computed grades (with the numbers behind each one) before writing anything** - e.g.
   "Highest score was Ainsworth's 142.3, over the 138.5 line → grading Over" - so the user can
   catch a misread stat before it hits the leaderboard, not after. This is the same sign-off
   requirement as drafting new props, not a lighter version of it - a wrong grade changes real
   standings immediately, same live-leaderboard mechanism as every prior grading pass this season.
4. **Only after sign-off**, write the grades:
   ```bash
   node -e "
   const { sql } = require('./api/lib/db');
   (async () => {
     await sql\`UPDATE questions SET correct_option = 'a' WHERE id = <id>\`;
     // one UPDATE per question, or batch with a CASE expression for several at once
     process.exit(0);
   })();
   "
   ```
   Nothing else is needed after this - the leaderboard (`api/leaderboard.js`) computes standings
   live from `correct_option`, there's no separate "publish the leaderboard" step.

## Weekly Pick'em props

Once real data exists for the upcoming week (run the data pull above first if it hasn't run yet -
this needs that week's `matchups.json` entry, which carries ESPN's own projected spread/over-under
per game), draft that week's weekly Pick'em props. **Always show the drafted props to the user and
get explicit sign-off before writing anything to the database** - this is a hard rule, not a
default that can be skipped because the props look obviously fine. Unlike matchups/standings/
rosters (pure facts, no review needed), a Pick'em prop is an editorial judgment call (which
storyline, which line, how many questions) that only the user should finalize, and once a manager
picks it and it locks, a bad line can't be quietly fixed.

**Ground every prop in real data, never invent a line.** The established pattern (see
`scripts/seed_pickem_week3_props.js` for a full worked example) pulls from:
- That week's own `matchups.json` entries - the real projected spread and over/under per game
  (e.g. "will the week's biggest spread get covered," "will the week's highest-projected game go
  over its total") are lines ESPN itself computed, not a guess.
- Recent weeks' actual results already on the site - highest/lowest scores, closest margins, and
  similar patterns from the last 2-3 weeks make good over/under lines for "this week's version of
  the same question" (see the Week 3 batch: highest individual score, closest margin, total
  combined points, all lined off Weeks 1-2's real numbers).
- Real season-to-date storylines when one exists (a hot or cold manager, a notable waiver pickup,
  two unbeaten teams playing each other) - these make more interesting head-to-head
  `this_or_that` props (two manager names as the options) than generic categories.

**Insert mechanics** - two checkpoints, not one, mirroring how commentary/power rankings stay
`published: false` until explicitly approved (Claude never types the `ADMIN_PASSCODE`, so every
step below is a direct Postgres write via `.env.local` + `node`, same as every prior Pick'em
change):
1. Copy the most recent weekly seed script (e.g. `scripts/seed_pickem_week3_props.js`) to a new
   one for this week's number, update its `QUESTIONS` array with the newly drafted props.
2. Set `WEEK` to the real week number, `points = 1` (the established weekly-prop tier - draft-day
   and weekly props are both 1, season-long batches are 3), and `LOCK_AT` to that week's *real*
   Thursday-night kickoff - pull it from ESPN's public scoreboard, not a guess:
   `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=N&seasontype=2&year=2026`
   (no auth needed), take the earliest `date` in the response. Set `published: false` in the
   insert (checkpoint 1: nothing goes live sight-unseen, even after a chat description).
3. **Show the user the full drafted list in chat and run the insert as unpublished** so they have
   something concrete to react to - a real question with an id is easier to approve/edit than a
   plan. State clearly that it's inserted-but-not-live yet.
4. **Only after explicit sign-off**, flip it live (checkpoint 2) - either Claude runs
   `UPDATE questions SET published = true WHERE week = <N>` the same way every prior grading/
   correction has, or the user flips individual questions themselves in `pickem-admin.html` with
   their own passcode if they'd rather review there. Don't flip anything the user hasn't actually
   responded to - "no objection after I posted it" is not sign-off, wait for a real yes.
5. If the user wants edits before or after that flip (wrong line, better wording), see
   HANDOFF.md's Pick'em sections for the direct `UPDATE questions SET ...` pattern used for every
   prior correction (grep for "id 44 replaced" or "Fix Season II" for worked examples).

**Season-long batches** (a second, occasional thing, not part of the normal weekly cadence) - see
`scripts/seed_pickem_season_v2_props.js` and HANDOFF.md's "Season II" section if the user asks for
a *new* season-long batch rather than that week's regular props. Same review-before-publish rule
applies, doubly so - those lock for the rest of the season, not just one week.

## Common issues

- **401 Unauthorized** — ESPN session cookies expired. Tell the user to re-grab `espn_s2`/`SWID`
  from a logged-in browser tab (DevTools → Application → Cookies → espn.com) and update
  `scripts/espn_credentials.json`; don't attempt this yourself.
- **`UNMAPPED_TEAM_<id>` showing up in output** — a new/changed team in ESPN isn't in
  `scripts/espn_team_map.json`. Run `python3 scripts/fetch_espn_week.py --map-teams` to refresh
  the template, then have the user fill in the missing manager name.
- **Power rankings come back empty** — expected before any games have been played that week (e.g.
  right after the schedule is finalized but before kickoff). Not a bug.
