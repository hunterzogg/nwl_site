---
name: weekly-espn-update
description: Pull this week's NWL fantasy football matchups, standings, and power rankings from ESPN into data/season_2026/*.json, then walk through reviewing and publishing the results. Use this whenever the user asks to update the site with this week's scores/matchups/standings, mentions running the weekly ESPN pull, says something like "pull this week's data" or "update the 2026 hub", or wants to publish power rankings/commentary for the current NWL season. Applies during the NWL season (roughly September through year-end) whenever real ESPN data needs to land on the site.
---

# Weekly ESPN update

Runs the NWL site's weekly data pull from ESPN and walks through publishing it. This is a thin
wrapper around `scripts/fetch_espn_week.py` — the script does the actual work; this skill's job
is to run it correctly, help review what it produced, and not skip the manual publish step.

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
```

No `--week` needed in the normal case — the script auto-detects ESPN's current scoring period.
Only pass `--week N` explicitly if the user asks for a specific past/future week (e.g. backfilling
a missed week, or pre-loading a schedule week before it's played). It's safe to re-run for the
same week any time — it overwrites that week's entry rather than duplicating it, so re-running
later in the day to catch a score correction is fine.

This writes/updates four files under `data/season_2026/`:

- `matchups.json` — that week's games and scores (factual, no review needed)
- `standings.json` — current W-L/points standings (factual, no review needed)
- `power_rankings.json` — a computed ranking draft for the week, `published: false`
- `commentary.json` — a blank stub (`title`/`body` empty), `published: false`

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
   git commit -m "Update week N data: matchups, standings, power rankings"
   git push
   ```
   Per this project's standing rule, always ask before running `git push` — don't assume a prior
   approval carries forward to this week's push.

## Common issues

- **401 Unauthorized** — ESPN session cookies expired. Tell the user to re-grab `espn_s2`/`SWID`
  from a logged-in browser tab (DevTools → Application → Cookies → espn.com) and update
  `scripts/espn_credentials.json`; don't attempt this yourself.
- **`UNMAPPED_TEAM_<id>` showing up in output** — a new/changed team in ESPN isn't in
  `scripts/espn_team_map.json`. Run `python3 scripts/fetch_espn_week.py --map-teams` to refresh
  the template, then have the user fill in the missing manager name.
- **Power rankings come back empty** — expected before any games have been played that week (e.g.
  right after the schedule is finalized but before kickoff). Not a bug.
