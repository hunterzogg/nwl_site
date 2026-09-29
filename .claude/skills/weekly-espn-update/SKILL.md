---
name: weekly-espn-update
description: Pull this week's NWL fantasy football matchups, standings, power rankings, and current rosters/trade values from ESPN into data/season_2026/*.json, then walk through reviewing and publishing the results AND drafting next week's Pick'em props. Use this whenever the user asks to update the site with this week's scores/matchups/standings/rosters, mentions running the weekly ESPN pull, says something like "pull this week's data" or "update the 2026 hub" or "refresh rosters" or "update the weekly pick'em" or "create next week's props", or wants to publish power rankings/commentary for the current NWL season. Applies during the NWL season (roughly September through year-end) whenever real ESPN data needs to land on the site. Note: the data-pull half also runs automatically on a schedule via .github/workflows/weekly-espn-update.yml — this skill is for an on-demand/manual run (e.g. the user wants fresher data right now, is troubleshooting, or wants that week's Pick'em props drafted, which the automated workflow never does).
---

# Weekly ESPN update

Runs the NWL site's weekly data pull from ESPN and walks through publishing it, then drafts that
week's Pick'em props for review. Two halves:

1. **Data pull** - a thin wrapper around `scripts/fetch_espn_week.py` (matchups/standings/power
   rankings/commentary) and `scripts/fetch_espn_rosters.py` (current rosters + trade values, for
   Trade Tools) - the scripts do the actual work; this skill's job is to run them correctly, help
   review what they produced, and not skip the manual publish step for the editorial pieces. A
   scheduled GitHub Action (`.github/workflows/weekly-espn-update.yml`) already runs both scripts
   automatically several times a week during the season and auto-commits matchups/standings/
   rosters (the facts) while still leaving power rankings/commentary unpublished for review - use
   this skill when the user wants a fresher pull right now rather than waiting for the next
   scheduled run, is troubleshooting a failed run, or wants Pick'em props drafted (which the
   automated workflow never does - see part 2).
2. **Pick'em props** - once real data exists for the upcoming week's matchups, draft that week's
   weekly Pick'em props grounded in it (see "Weekly Pick'em props" below). **Never publish these
   without the user's explicit sign-off** - draft, insert unpublished, show the user, wait for a
   real yes, only then flip live.

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
just having run the script is enough for those two files. Power rankings and commentary are the
editorial layer and are deliberately never auto-published, so always do the following instead of
treating the script's success as "done":

1. **Show the user what changed.** Summarize the week's matchup results and standings movement
   briefly in chat so they don't have to open the JSON themselves.
2. **Surface the computed power rankings** (`power_rankings.json`'s newest entry) for the current
   week. If there aren't enough played games yet to rank anyone (e.g. week 1 before kickoff),
   say so plainly rather than presenting an empty list as a problem.
3. **Ask whether to write commentary** for the week — the `commentary.json` stub ships with empty
   `title`/`body`. If the user wants a recap, draft it with them (or from the matchup data) and
   fill in the stub; don't invent opinions or storylines that aren't grounded in the actual scores.
4. **Flip `published: true`** on the power rankings and commentary entries for the week only once
   the user has actually reviewed/approved them — never do this automatically as part of running
   the script. Edit the JSON directly (find the entry matching the current `week`, set
   `"published": false` → `"published": true`).
5. **Remind the user that nothing here touches git.** The data files are now updated locally, but
   the live site (GitHub Pages + Vercel) won't see any of it until it's committed and pushed:
   ```bash
   git add -A
   git commit -m "Update week N data: matchups, standings, power rankings, rosters"
   git push
   ```
   Per this project's standing rule, always ask before running `git push` — don't assume a prior
   approval carries forward to this week's push.

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
