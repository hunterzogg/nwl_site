# NWL Data Cleanup — Manual Review Log

This file tracks every item found during data cleanup that needs your review/decision.
Nothing in the final tables has been silently guessed at without being noted here.

---

## Resolved (fixed by you in the spreadsheet, re-verified)

1. **2013, Week 6** — Fixed. Matchup now resolves cleanly.
2. **2019, Week 15** — Fixed. Matchup now resolves cleanly.
3. **2023, Week 1** — Fixed. Conlin's score discrepancy resolved.
4. **2023, Week 16** — Fixed. Palaia's score discrepancy resolved.
5. **2024, Week 17** — Fixed. Zogg's score discrepancy resolved.

Full validation re-run after your fixes: 1,272 matchups, 0 duplicate/missing manager
issues across all 217 team-weeks. Matchup results table is now fully clean.

## Corrections applied earlier in cleanup (for your awareness, no action needed)

- 2017, Week 9: "Brent" -> corrected to "Prodahl" (per your confirmation)
- 2024, Week 1: "Goetz" (loser) -> corrected to "Prodahl" (score match: 86.36)
- 2022, Week 17: "Ainsworth" (loser) -> corrected to "Larson" (score match: 71.7)
- 2024, Week 14: "Prodahl" (loser) -> corrected to "Palaia" (score match: 122.4)
- 2021, Week 16: Winner/loser names were swapped relative to scores - corrected to
  winner=Pfaffinger, loser=Glaser

## Design decisions made during cleanup (for your awareness)

- **Transactions table excludes "Drafted" rows** - every draft pick already appears in
  draft_picks.csv with full detail, so the 2,526 "Drafted" rows in the original
  Transaction History sheet were not duplicated into transactions.csv.
- **Capitalization normalized**: "lost"/"Lost" -> bid_outcome: lost,
  "Traded for"/"Traded For" -> acquisition_type: trade.

## In progress — site changes requested, being implemented now

- Rename league: "Sydney Sweeney Dynasty League" -> "National Wayzata League" (NWL)
- Simplify homepage scorebug (fewer summary stats)
- Hand-built SVG league logo (no raster/AI image-gen tool available in this
  environment, so logo is constructed as scalable vector graphics matching the
  dark mode red/white/blue palette)

---

## Pending page rebuilds — requested, scoping in progress (not yet built)

### Scorigami page rework
- Rebuild as a visual grid resembling nflscorigami.com (winning score vs losing score
  matrix, shaded cells, hover-to-reveal occurrence detail) instead of the tile-grid
  version currently live.
- Remove the margin-of-victory data point from the design.
- Axis ranges should start at "realistic" numbers (trim dead space) rather than 0.
- Open questions before building: exact axis range, axis orientation, tie-game
  handling, and how much detail to show on hover for scores that repeated multiple
  times.

### Rankings page rework
- Change from manager-career-level rankings to individual manager+season ("team-season")
  rankings - i.e. each manager's 2013 team, 2014 team, etc. are ranked separately
  against every other team-season in league history, not rolled up into one career
  number.
- Add a second, separate table ranking playoff team-seasons only (playoff week range
  varies by year - 14-16 or 15-17 depending on season format that year).
- Open questions before building: whether to keep the scoring-era adjustment applied
  at this per-season level, whether to rank by points-per-game average vs. total
  points, and how to define "playoff weeks" precisely (using existing game_type
  tagging vs. only weeks where that manager made the actual playoff bracket).

## Scope confirmed — Scorigami rework (ready to build)

1. Show every score that has occurred. Apply a "smart filter" to the long tail:
   scores in the common range stay fully visible; for outlier scores below ~50 or
   above ~150, only show them if they've occurred frequently enough to be worth
   displaying (exact frequency threshold to be tuned at build time, low numbers like
   below 40 are not displayed even if present).
2. Winning score on X-axis, losing score on Y-axis - mirrors nflscorigami.com exactly.
3. Tie games are included on the grid (winning_score == losing_score cell). Doesn't
   matter which manager is labeled winner/loser for a tie.
4. Hover tooltip shows: total occurrence count + most recent occurrence (season/week/
   managers), not a full list of every occurrence.

## Scope confirmed — Rankings rework (ready to build)

1. Each row = one manager+season ("team-season"). Show BOTH raw (unadjusted) and
   scoring-era-adjusted average side by side. Default sort = adjusted average.
   Provide a way for the user to re-sort by raw/unadjusted average instead.
2. Ranking metric = average points per game (not total points).
3. Two separate tables: regular season team-seasons, and playoff team-seasons.
   Playoff/regular split by season, confirmed exact week ranges:
     - 2013: regular = weeks 1-15, playoffs = weeks 16-17
     - 2014-2016: regular = weeks 1-14, playoffs = weeks 15-17
     - 2017-2020: regular = weeks 1-13, playoffs = weeks 14-16
     - 2021-present: regular = weeks 1-14, playoffs = weeks 15-17
   NOTE TO SELF AT BUILD TIME: verify this matches the game_type tagging already
   derived from each year's sheet header structure (Reg Finish/Final Finish column
   split) during original extraction - reconcile if they don't line up exactly.

## Scope confirmed — Draft page rework (ready to build)

### Bug fix
- Season filter on Draft Board tab is broken. Root cause confirmed: `p.season` is
  converted to a number via parseInt, but the season dropdown's value is always a
  string, so the strict equality filter (`p.season === season`) never matches and
  silently returns zero rows. Fix: convert season to a number before comparing (or
  use loose comparison), and apply the same audit to manager/type filters on other
  pages in case the same bug pattern exists elsewhere.

### Draft Strategy tab
- Add that season's final finish next to each manager's round 1-3 strategy row (so
  strategy can be visually compared against outcome).
- Add a summary table: for each unique strategy (e.g. RB-RB-RB), show average finish,
  number of times used, number of championships resulting (finish = 1st), number of
  "sackos" resulting (finish = 12th, i.e. last place).

### Draft Board tab
- Capitalize all NFL team acronyms for consistent display.
- Add a player name search/lookup - typing a player's name shows every year/manager
  that has ever drafted them.
- Add position and NFL team as additional filter dropdowns (alongside existing
  season/manager filters).

### New: Draft Position Analysis
- New section/tab analyzing performance by draft slot (1st overall, 2nd overall, etc.)
  - e.g. average season finish for managers who drafted 1st overall, average PPG for
  managers who drafted 6th overall, etc. - aggregated across all years for each slot.

## Transactions page rework - scope investigation in progress

### Bug fix (same root cause as Draft page)
- Season filter on Transactions page has the identical string-vs-number comparison
  bug as the Draft page. Same fix applies.

### Confirmed straightforward additions
- Add player name search/lookup (same pattern as Draft page).
- Capitalize "Outcome"/bid_outcome column values for consistent display.

### Data availability findings - IMPORTANT, differs from original request
Investigated the requested Year End Report sheets for dated transaction logs and
trade-pair data. Findings:
  - 2020 Year End Report sheet does NOT exist in the workbook at all.
  - 2021 Year End Report: no dated transaction log and no trade-pair table found
    anywhere in the sheet.
  - 2022 Year End Report: has a trade-pairs table (Team 1/Player Received/Team 2/
    Player Received) but only tagged at WEEK-level granularity (e.g. "BEFORE WEEK 6"),
    not exact dates. No dated waiver/FA transaction log found.
  - 2023 Year End Report: HAS both - exact-date Trade Recap table, and exact-date
    transaction log (Date, Player, Position, Team, Bid, Results, Tenure).
  - 2024 Year End Report: HAS both, same shape (Trade Report + dated transaction log).
  - 2025 Year End Report: HAS both, same shape.

Open questions sent to Hunter (awaiting answer):
  1. Trade Database: should 2022 trades show with week-level reference (not exact
     date) and 2013-2021 trades show at season-level only (using existing
     acquisition_type=trade rows), with full exact dates only for 2023-2025? I.e.
     mixed precision across eras, matching the "pre-2020 stays at year-level" idea
     but extended to cover 2021-2022 since date data doesn't exist for them either.
  2. Day-by-day transaction dates: only feasible for 2023-2025 given what's actually
     in the workbook. Confirm whether to proceed with dates merged in for just those
     3 years (2013-2022 remain season-level, as they are today), or whether there's
     another location in the spreadsheet for 2020-2022 dates that hasn't been found yet.

### New: Trade Database sub-page
- Once data-availability questions above are resolved, build a dedicated sub-page
  listing all completed trades league-wide, pulled from the Trade Recap/Trade Report
  tables (2022-2025) plus the existing acquisition_type=trade transaction rows
  (2013-2021, season-level only).

## Scope confirmed — Transactions page rework (ready to build)

1. **2022 trades**: use the table starting around G505 on "2022 Year End Report".
   Structure confirmed: columns are Team 1 / Player Received / Team 2 / Player Received,
   with week-level timing (e.g. "BEFORE WEEK 6") instead of exact dates. NOTE: this
   region of the sheet is irregular - the trade-pairs table is interleaved with a
   separate "player value before/after trade" comparison table, with header rows
   repeating at uneven offsets. Will need careful manual mapping at build time, not a
   simple uniform table read. 2022 and earlier: date column = year only (mixed
   precision confirmed fine).
2. **Date merging**: confirmed - merge exact dates for years where available
   (2023-2025), leave year-only in the date column for years without exact dates
   (2013-2022).
3. **2023 transaction log**: ignore the "Tenure" column when extracting.

All other scope from the previous Transactions entry (season filter bug fix, player
lookup, capitalize outcome values, Trade Database sub-page) still applies as written.

## NEW SCOPE AREA — Current season (2026) pages — Phase 2/3, scoping in progress

This maps to the originally-planned Phase 2 (live ESPN data) + Phase 3 (weekly
approval workflow) from our first design conversation, deliberately deferred until
the Phase 1 historical archive was solid. Hunter wants to start scoping this now.

Requested pages/features:
  - Current matchups (this week's live/upcoming games)
  - Power rankings (weekly, AI-assisted, was already planned to go through Hunter's
    approval before publishing - confirm still true)
  - Standings (live, current season)
  - Weekly commentary / recap (was already planned to go through Hunter's approval -
    confirm still true)

Open questions sent to Hunter (awaiting answers):
  1. Season timing: it's June 2026, NFL season hasn't started, so there's no live
     2026 data yet regardless of API setup. Build now with placeholder/empty states
     ready for kickoff, or hold off building this section until closer to the season?
  2. ESPN API access: confirm whether Hunter already has league ID + auth (session
     cookie/token if private league) sorted, or whether that's still TBD.
  3. Confirm power rankings + weekly commentary both still go through Hunter's
     manual approval before publishing (per his "semi-automatic" answer earlier in
     the project), rather than fully automated.
  4. Nav/IA placement: new top-level nav section (e.g. "2026 Season" alongside
     Lookup/Scorigami/Rankings/Draft/Transactions), or does the homepage itself
     become the "current season" hub with the historical archive demoted to
     secondary nav?

Not yet scoped: no build started, no specific page designs - this is intentionally
a placeholder for the next planning conversation once Phase 1 polish wraps up.

## Data findings during Phase 1 batch build

- **No trade records exist for 2013-2021** anywhere in the workbook (Player
  Transaction History sheet has zero "Traded For" rows for those years). Trade
  Database will only have real coverage from 2022 onward - this is a source data
  gap, not an extraction limitation.
- **2023 Year End Report's "Trade Recap" table contains 2024-dated trades**, not
  2023-dated ones (e.g. dates like 2024-09-27 appear under the sheet labeled "2023").
  Resolved automatically: trades are now tagged by season inferred from the actual
  date (Aug-Jan = that year's season; Jan-Jul = previous year's season) rather than
  trusting which sheet tab they were found under. This correctly reassigned those
  trades to 2024.
- **2022 trade data has no reliable per-trade date/week** - the G505 trade-pairs
  table is interleaved with an unrelated "player value before/after trade" table on
  the same rows, and the "BEFORE WEEK X" markers belong to that other table, not the
  trade pairs. 2022 trades are extracted with team/player pairing intact, but fall
  back to year-only precision rather than the week-level detail originally hoped for.

## Scope confirmed — round 3 of notes (not yet built)

### Scorigami
- Remove the smart-filter entirely. Show every score that has occurred, no floor,
  no exclusions. (Supersedes the earlier "filter below 40, smart-filter outliers"
  decision - turns out all outliers were one-offs anyway, so filtering was removing
  real data Hunter wants visible.)

### Draft page
- Color-code positions everywhere they appear on the site (not just draft strategy):
  QB = Red, RB = Green, WR = Blue, TE = Yellow, D/ST = Brown. Need a consistent
  color token added to the design system and applied to every position tag site-wide
  (draft board, strategy tables, etc).
- Draft Slot Analysis tab is empty - root cause confirmed: same string-vs-number
  comparison bug as the earlier filter bugs (draft_slots.json season field was never
  parsed to int before comparing against team_seasons season field, so the lookup
  silently matched nothing).
- FIX APPROACH: use "Mgr Summary" sheet, table starting at A84
  ("DRAFT POSITION AND OVERALL FINISH") as the authoritative source instead of
  re-deriving from round-1 picks. Confirmed structure: one row per manager, then a
  repeating pair of columns per year (2013-2025) for [draft position, finish].
  This directly pairs draft slot with finish with no join needed, more reliable
  than the round-1-pick inference approach.

### Transactions page
- Transaction log: when a waiver claim has a matching "Win" and "Lost" row with the
  same date (i.e. multiple managers bid on the same player same day), nest the
  losing bid(s) under the winning claim instead of listing them as separate
  same-level rows - since the losing bid didn't result in an actual roster move,
  it shouldn't visually look like its own transaction, but should still be
  documented (showing who else bid and lost). Winner displayed on top, losing
  bid(s) nested/indented underneath.
- Add summary-level transaction analytics to the page: transactions per team per
  season, total league transactions per season (trend over time), and a breakdown
  of waiver adds vs. trades vs. free agent pickups (proportions/trends).

### Clarification on waiver nesting
- Confirmed: when multiple managers bid on the same player/date, ALL losing bids
  nest under the single winner (not just a 1-winner-1-loser simple case).

## Batch build complete - round 3 changes

All items from the round 3 notes are now built:
- Scorigami: filtering removed entirely, shows all 1,087 unique score combos with no floor.
- Draft: position color-coding (QB red, RB green, WR blue, TE yellow, D/ST brown)
  applied site-wide via shared posTag() helper. NOTE: 2 positions outside the 5
  requested (K = kicker, HC = head coach) appear in the data but weren't given a
  color in your spec - these render in default muted text rather than guessing
  at a color. Let me know if you want colors assigned to these too.
- Draft Slot Analysis: fixed using Mgr Summary's "DRAFT POSITION AND OVERALL FINISH"
  table (row 84) as the authoritative source instead of the buggy round-1-pick
  inference. Cross-validated against original round-1 picks (matches exactly) and
  Stowe's known 4-season tenure (matches exactly).
- Transactions: waiver bid nesting implemented - losing bids nest under the winner
  when they share an exact season+date+player. Restricted to rows with real dates
  (2023-2025 mostly); year-only rows aren't grouped since multiple unrelated
  same-season transactions could falsely merge otherwise. New Summary tab added:
  league totals by season (with type breakdown), per-manager career transaction
  counts, and overall acquisition-type percentage breakdown.

## Round 4 fixes - bugs found and corrected

- **Manager colors**: regenerated all 13 colors using evenly-spaced hues with
  alternating lightness/saturation bands (rather than picked-by-eye), specifically
  to fix Zogg/Ainsworth/Larson being too visually similar and to be more robust for
  colorblind viewers (lightness varies even when hue confusion occurs).
- **Draft position colors not appearing - ROOT CAUSE FOUND**: draft.html had a leftover
  local `.pos-tag` style (from before the site-wide color system existed) that set
  a flat muted color and, because it loaded after the shared stylesheet, silently
  overrode every position color on that page. Removed the local override.
- Added K (teal) and HC (gray) position colors per your direction.
- **Draft Slot Analysis table**: replaced "Times Used" column with Championships and
  Sackos columns, computed using the same dynamic per-season last-place detection
  used elsewhere (handles 2013's 10-team field vs. 12 teams in later years correctly).
- **Trade Database - ROOT CAUSE FOUND AND FIXED**: the extraction was reading 120 rows
  past the real end of each year's trade table without a proper stop condition, which
  caused it to accidentally vacuum up rows from a completely unrelated table further
  down the sheet (the weekly waiver-results pivot) and display them as garbage trades.
  Fixed by stopping the scan as soon as a row is fully blank across all 5 trade
  columns, which reliably marks the table's true end.
  - Also discovered while fixing: the 2023 Year End Report's "Trade Recap" table
    contains dates that are actually from 2024, not 2023 (confirmed: the 2023 sheet's
    separate transaction LOG table has correct 2023 dates, so this issue is isolated
    to the trade table specifically - looks like a copy/paste or template carryover
    error in the original spreadsheet). To avoid risk of duplicating or conflicting
    with 2024's own correctly-dated trade table, the 2023 sheet's trade table is now
    excluded entirely. Result: there are currently no trade entries for 2023 specifically.
  - Also fixed the 2022 G505 extraction to only accept rows where both "team" values
    are recognized manager names, filtering out the interleaved unrelated "player
    value before/after trade" table that was producing garbage rows.
  - Final corrected trade counts: 2022 (13, year-only precision), 2023 (0, excluded
    for data quality reasons above), 2024 (13, exact dates), 2025 (27, exact dates).
    Total 53 trades, all verified to have complete team1/team2/received data.

## Round 5 - Trade Database position prefixes

Added "POS - Player Name" formatting to every player in the Trade Database (both
team1_received and team2_received columns), matching the requested format (e.g.
"TE - Harold Fannin Jr."). Position data sourced by cross-referencing player names
against draft_picks.csv and transactions.csv (949 known players), with name
normalization to handle punctuation/suffix mismatches (periods, hyphens, Jr/Sr/II/III).
Non-player items (FAAB amounts, draft pick references like "Pick 27") are correctly
left untagged. Two real players have no position match anywhere in the league's
internal data (never drafted or involved in a logged waiver/FA transaction) and
remain untagged: Devon Achane, Wandale Robinson.

## Round 6 - Resumed from handoff: verified mid-session work, built Managers page

- Verified all "mid-session changes not yet completed" items from HANDOFF.md by running
  the site in a browser: Transactions Summary tab, Rankings manager+season filters, and
  Draft Round 1-3 Strategy year filter all work correctly with no console errors. No fixes
  were needed - the code was already correct, just never smoke-tested.
- Bug found and fixed: the homepage's "Historical Lookup" card linked to pages/lookup.html,
  which no longer exists (the page was renamed to hall-of-fame.html earlier in the project
  but this link was never updated) - a 404 on click. Fixed to point at hall-of-fame.html and
  renamed the card title to match the nav ("Hall of Fame").
- Built the Managers page (pages/managers.html), added to nav in shared.js. One card per
  manager, click to expand:
  - Tenure (first-last season, "present" if still active) and season count, computed
    dynamically from team_seasons_regular.json - no hardcoded tenure data. Former managers
    (Stowe only, 2013-2016) get a "Former Manager" badge and sort to the end of the grid.
  - Career stats: titles, sackos, career W-L record (from matchup_results.json), career PPG
    and playoff PPG (weighted by games across all seasons), playoff trips.
  - Top 5 earliest-overall draft picks, top 5 waiver/FA pickups by FAAB bid amount, and the
    5 most recent trade acquisitions - all derived from existing data files, no new
    extraction needed.
  - Profile picture support: drop a {manager-lowercase}.jpg into assets/img/managers/ (e.g.
    conlin.jpg) and it displays automatically; falls back to a colored initials circle if no
    image exists. No manager photos have been added yet.
  - New data file: data/manager_profiles.json - one entry per manager with
    favorite_nfl_team (string) and team_names (array of {name, seasons}). Both are empty for
    every manager right now since this data doesn't exist anywhere in NWL_Master.xlsx or the
    rest of the site - there's no source to extract it from. Hunter can hand-edit this file
    directly (same pattern as the rest of the data layer) to fill in favorite teams and team
    name history per manager; the page picks it up automatically with no code changes.
- Not done: no manager photos or profile data (favorite team / team names) added - needs
  Hunter's input, not extractable from the spreadsheet.
- Removed data/transactions.json - a stale pre-date-merge duplicate of
  transactions_with_dates.json that no page actually loaded. Every page has always used
  transactions_with_dates.json; the old file was dead weight (~290KB).

## Round 7 - Hunter's review notes, batch 1

- **Achane/Robinson mystery solved**: the earlier "no position match anywhere" finding
  (Round 5) was wrong - it was a string-matching bug, not a data gap. The player existed with
  three different spellings across sheets: draft_picks/transactions used "De'Von Achane" and
  "Wan'Dale Robinson" (with apostrophes), while trades.json used "Devon Achane" and "Wandale
  Robinson" (no apostrophe, different capitalization). The apostrophe mismatch broke the
  cross-reference lookup used in Round 5's position-tagging pass. Standardized to Hunter's
  requested spelling - "DeVon Achane" and "WanDale Robinson" - across all three data files,
  and added the correct position prefixes (RB / WR) in trades.json now that the names match.
- **Managers page nav bug**: root cause was `index_standalone_preview.html`, a static decorative
  homepage mockup with hardcoded dead-end nav links that predates the Managers page and still
  said "Lookup". Updated its nav to real relative links and added a caption clarifying it's a
  static snapshot, not the live site. Also added a cache-busting `?v=2` query to the shared
  CSS/JS `<link>`/`<script>` tags on every page - while testing this session a browser caching
  bug surfaced on the plain `python3 -m http.server` (no cache-control headers), so this is
  cheap insurance against the same class of "my change isn't showing up" report recurring.
- **Managers page - Favorite Players**: replaced "Top Draft Picks" with "Favorite Players" -
  ranks by total roster-appearance count per player (draft picks + won waiver/FA adds + trade
  acquisitions, name-matched), not draft capital. Ties broken alphabetically.
- **Managers page - Playoff Trips fix**: was counting any season with logged playoff-week games,
  which included consolation/placement bracket participants. Now counts only seasons where
  final_finish <= 6 (actual playoff qualification).
- **Trade Database player search**: added, same pattern as the other player search inputs
  site-wide.
- **Hall of Fame Seasons tab was empty - ROOT CAUSE FOUND**: same string-vs-number comparison
  bug documented earlier for Draft/Transactions (`r.season === season` where season came from a
  select value, always a string, against r.season which had been parsed to an int). Every
  filter silently matched zero rows. Fixed by parsing the select value to int. While rebuilding,
  also implemented Hunter's spec: Weekly Scores grid is now the top table (was below standings),
  Standings are grouped by division and sorted by win count within each group, and a per-season
  header shows the top 3 finishers (medal emoji) and the last-place finisher, sourced from
  team_seasons_regular.json's final_finish field (the same authoritative post-season standing
  used everywhere else on the site).

## Round 8 - Hunter's review notes, batch 2 (required NWL_Master.xlsx)

### Team name history
Extracted from "All Time Team Ranks", the per-team-season table starting row 12 (Team, Team Name,
Year, Pts/Gm, Adj Pts/Gm, Rank columns) - 154 rows, matching one row per manager-season exactly
like team_seasons_regular.json. Grouped consecutive-same-name seasons into ranges (e.g. "Team
Muenchow" 2018-2020) and wrote into data/manager_profiles.json's team_names field for all 13
managers. Managers page picks this up automatically, no code changes needed.

**Resolved**: "Da Raiders" (2014) is Ainsworth's team name that season - confirmed by Hunter.
Added to Ainsworth's team_names timeline between "maybe next year" (2013) and "da ains" (2015).

### 2023 Trade Database gap - filled
Found the table exactly where Hunter said: "2023 Year End Report", row 52 header ("Date, Team 1,
Player Received, Team 2, Player Received"), data rows 53-81, ending cleanly before the next table
("Projected vs Actual") at row 84. 16 trades extracted, position-tagged using the same
normalized-name lookup built for the Achane/Robinson fix (945-player reference table from
draft_picks.json + transactions_with_dates.json) - all 16 matched cleanly, zero left untagged.
Merged into trades.json (53 -> 69 total trades). Updated the Trade Database's caveat text on
pages/transactions.html since the "2023 excluded" language is no longer true.

### Transaction log date reconciliation
Investigated thoroughly before changing anything, since the Round 5 "no data exists" claim about
Achane/Robinson turned out to be a matching bug, not a real gap - wanted to be sure this wasn't
the same mistake twice.

- **2013-2021**: confirmed via the master "Player Transaction History" sheet itself that these
  years contain *only* "Drafted" rows - zero waiver/FA/trade transactions logged at all for that
  era (the league apparently didn't track weekly transactions before 2022). This isn't a gap in
  the site's extraction; the source data simply doesn't exist. No change possible here.
- **2021 and 2022 Year End Report sheets**: did a full scan for datetime-typed cells anywhere in
  both sheets (not just keyword-matching table headers, in case a dated table used unlabeled date
  columns). Zero datetime cells found in either sheet. 2022's "Waiver Results" table (row 212) has
  Player/Position/Team/Bid/Results/amount-overpaid columns but no date column at all. Confirms
  the earlier finding: 2022 genuinely cannot get exact waiver/FA dates from this workbook. 2022
  trades already correctly show year-only precision (unchanged, matches Hunter's specific
  callout).
- **2023-2025**: this is where the real improvement was. Rebuilt the full transaction log from
  scratch: base records from "Player Transaction History" (matches the site's existing
  1,864-row dataset almost exactly, 1,869 vs 1,864 - trivial extraction-detail differences, not a
  data problem), then matched each row against a combined, deduplicated pool of every dated
  waiver/FA log entry from all three Year End Report sheets (2023 row 305+, 2024 row 75+, 2025 row
  113+), keyed on normalized player name + manager + acquisition type + outcome + bid amount.
  Season was inferred from the actual date (Aug-Dec = that year, Jan-Jul = previous year) rather
  than trusted from which sheet tab the row came from, since the 2024 sheet's log runs
  continuously into December 2025 without a break - same "sheet tab isn't the source of truth"
  lesson learned from the 2023 trade-date mislabeling in Round 3.
  - Trade-type line items (individual players from "Traded For" rows) don't appear in the dated
    waiver/FA tables at all, so those were separately matched against this session's own
    newly-dated trades.json instead (which now has exact dates for 2023-2025).
  - Coverage improved substantially: 2023 exact-dated rows went from 286/350 to 349/350 (99.7%),
    2024 from 405/608 to 562/608 (92.4%), 2025 from 453/578 to 566/578 (97.9%).
  - **59 rows remain year-only** (2023: 1, 2024: 46, 2025: 12) - these exist in the master
    transaction summary sheet but have no corresponding line item in that year's dated log table,
    meaning the source spreadsheet itself has no exact date recorded for them. Not fixable without
    Hunter cross-referencing manually; left as year-only rather than guessing.
  - Replaced data/transactions_with_dates.json entirely with this rebuilt version (1,869 rows).
    Verified in browser: Transaction Log, waiver-bid nesting, and Summary tab all still render
    correctly with no console errors.

## Round 9 - Hunter's review notes, batch 3 (required NWL_Master.xlsx)

### Transaction date investigation - found and fixed a systemic bug, not just gaps
Hunter asked to dig further into the 59 rows left year-only after Round 8. Found two real bugs
in the matching approach, both fixed:
  - **Year-mislabeled tail rows**: the "2024 Year End Report" sheet's dated transaction log runs
    continuously past its own season into rows showing calendar dates in December *2025* -
    exactly the same copy/paste year-typo pattern already found in the 2023 trade table (Round 3).
    Confirmed by matching evidence (e.g. a "2025-12-13" tail row for Brenton Strange/Conlin/Free
    Agent was the *only* candidate for an unmatched 2024 base row with identical manager/type) -
    corrected these rows to the sheet's actual year rather than trusting the cell's literal year.
    This alone recovered 40 of the 46 stuck 2024 rows.
  - **Overly aggressive dedup**: the pool-building step was collapsing identical-looking dated
    rows (same date/player/manager/type/outcome/bid) down to one, on the assumption they were
    cross-sheet duplicates. Turned out some are genuine repeat transactions (a player dropped and
    re-added the same way later) that need to stay as separate candidates. Removed the dedup step
    entirely - sequential one-to-one consumption already handles real cross-sheet duplicates fine
    without it.
  - **Final coverage**: 2023 349/350 (99.7%), 2024 605/608 (99.5%), 2025 566/578 (97.9%). Only 16
    rows total remain year-only, and each one is a genuine source-data discrepancy - the master
    summary sheet records one more occurrence of that exact player/manager/bid/outcome combo than
    the day-by-day log does, for that specific season. Verified this isn't fixable by widening the
    match (checked every remaining case individually) - it's the source spreadsheet itself
    disagreeing with itself by exactly one row per case, not a matching problem.

### Team Rankings rename
Renamed "Rankings" to "Team Rankings" everywhere: nav (shared.js), page title/h1
(rankings.html), homepage card (index.html), and the standalone preview mockup.

### Hall of Fame Seasons - playoff weeks added
Turned out this needed no new extraction - playoff-week scores were already sitting in
weekly_scores.json (game_type: 'playoff'), just never displayed. Added a second "Weekly Scores -
Playoffs" table right after the regular-season one, using whatever playoff weeks/managers exist
for that season (correctly variable - e.g. 2018 shows Wk14-16, matching that era's schedule; only
managers who actually made playoffs appear in the table).

### Transactions Summary - most/fewest per season
Also needed no new extraction - manager_season_tx.json (already sourced from Mgr Summary per the
existing data-sourcing table) already has count-per-manager-per-season. Added "Most in a Season"
and "Fewest in a Season" columns to the per-manager table, computed client-side as the max/min
across each manager's seasons with the year shown alongside.

### Team Rankings - Opponent PPG toggle
Extracted the "Points Against" table from All Time Team Ranks, column U row 11 (Team, Team Name,
Year, Pts Against/Gm, Adj Pts Against/Gm, Rank - 154 rows, one per regular-season team-season).
Added `opp_ppg` (raw) into team_seasons_regular.json. For "adjusted" opponent PPG, applied the
*same* per-season adjustment factor the site already computes for scored PPG (rather than using
the spreadsheet's own separately-computed "Adj Pts Against/Gm" column), so "adjusted" means the
same thing consistently across every column on the page. Added a third sort button and two new
always-visible columns (Opp. Adj. PPG, Opp. Raw PPG) to the Regular Season tab only - this data
doesn't exist for playoffs in the source. Same "Da Raiders" 2014 quirk showed up again in this
table (same underlying sheet); remapped to Ainsworth per Hunter's earlier confirmation.

### Playoffs tab - rank comparison column
Added a "Playoff Rank − Reg. Rank" column. Both ranks are fixed (computed once by adjusted PPG
across the *entire* dataset, independent of whatever filter/sort the user has active) so the
comparison stays meaningful no matter how the table is currently filtered. Negative (playoff rank
number is smaller/better than regular season rank) shown in red, positive in green, per Hunter's
exact spec - colors reused from the site's existing QB-red/RB-green position-tag palette rather
than introducing new ones.

## Round 10 - Hunter's review notes, batch 4

- **Reversed the playoff rank comparison formula**: was `playoffRank - regRank`, now
  `regRank - playoffRank` per Hunter's correction. Column header updated to "Reg. Rank − Playoff
  Rank" to match. Colors (red negative, green positive) unchanged - with the formula flipped, they
  now read more intuitively too (positive/green = playoff rank beat regular-season rank).
- **Draft Slot Analysis**: best Avg PPG highlighted green, worst highlighted red.
- **Manual fixes to the remaining year-only transactions**, per Hunter's direct review of the
  residual list from Round 9:
  - Removed all 12 remaining year-only 2025 rows - Hunter confirmed these were duplicates of
    other, already-dated 2025 records (the master summary sheet double-counted them).
  - Removed 2 duplicate 2024 rows: Buccaneers/Prodahl and Emanuel Wilson/Zogg.
  - Keaontay Ingram (2024, Larson, free agent) dated to 2024-09-18.
  - Chig Okonkwo (2023, Prodahl, waiver) dated to 2023-12-06, and renamed to "Chigoziem Okonkwo"
    to match the spelling already used in draft_picks.json - same player, and leaving the
    nickname in place would've split his Favorite Players roster count on the Managers page
    across two "different" players (same class of bug as the Achane/Robinson fix in Round 7).
  - **Result: 2023, 2024, and 2025 are now 100% exact-dated.** Only 2022 (no date source exists)
    and 2013-2021 (no data exists at all, pre-2022) remain year-only or absent, both for
    documented, unfixable source-data reasons.

## Round 11 - Phase 2 kickoff: ESPN fetch pipeline

Talked through the Phase 2 design with Hunter before building anything, per his request. Locked
in: new top-level "2026 Season" nav tab (not a homepage takeover), one page with four tabs
(Matchups/Standings mechanical, Power Rankings/Commentary editorial), and a script-based publish
workflow (no backend, no admin page - the review step before committing *is* the approval gate).

Confirmed league 39276 is private: `curl` against
`lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/39276` returns
a clean `401 AUTH_LEAGUE_NOT_VISIBLE`, not just a login-page redirect - unambiguous, not a guess.

Built `scripts/fetch_espn_week.py`: pulls matchups + standings from ESPN and writes them straight
to `data/season_2026/*.json`; also creates `published: false` stub entries for power rankings and
commentary (never auto-fills real editorial content - that stays a manual/collaborative step).
Auth cookies (`espn_s2`, `swid`) live in `scripts/espn_credentials.json`, which is gitignored and
excluded from `nwl_site.zip` - flagged clearly in the script's own docstring and in HANDOFF.md
that this file must never be committed or shared, since it's Hunter's personal ESPN login
session, not an API key. `scripts/espn_team_map.json` (ESPN team ID -> manager name) gets
generated by running the script with `--map-teams` once auth is working.

Not yet done: no real data pulled (need Hunter's cookies first - can't safely generate or guess
those), and the actual `pages/season-2026.html` UI isn't built yet. That's the next step once the
data pipeline is verified end-to-end against a real fetch.

**Follow-up fix**: Hunter hit `SSL: CERTIFICATE_VERIFY_FAILED` running the script - the standard
python.org macOS installer for Python 3.7 doesn't wire itself up to the system's trusted
certificate store, and the usual fix (running `Install Certificates.command`) wasn't available on
his machine (the app folder that normally ships it wasn't present). Installed `certifi` and
updated `fetch_league_raw()` to build an explicit `ssl.SSLContext` from `certifi.where()` and pass
it into every `urlopen()` call, so the script no longer depends on the OS/Python install having
working default certs. Verified the fix with dummy credentials - request now reaches ESPN's
servers and gets a clean 401 instead of failing at the TLS handshake.

**Second follow-up fix - wrong output directory**: Hunter ran Step 4 for real and the output
landed in `scripts/data/season_2026/` instead of `data/season_2026/`. Root cause: `SCRIPT_DIR =
Path(__file__).parent` - when the script is invoked as a bare relative filename from inside its
own directory (`python3 fetch_espn_week.py` while cwd is already `scripts/`), `__file__` has no
directory component, so `Path(__file__).parent` evaluates to `Path('.')`. Pathlib's `.parent` on
a bare `.` returns `.` again (it doesn't walk up a real directory), so `SITE_DIR =
SCRIPT_DIR.parent` silently ended up equal to `SCRIPT_DIR` itself instead of one level up. Fixed
by resolving to an absolute path first - `Path(__file__).resolve().parent` - which sidesteps the
ambiguity entirely and works correctly regardless of how the script is invoked. Removed the
misplaced `scripts/data/` directory Hunter's premature run created. His `espn_team_map.json` was
already fully filled in (no leftover `FILL_IN_MANAGER_NAME` placeholders), so nothing else needed
redoing - just re-run Step 4.

Also worth noting for next session: while fixing this, testing the SSL fix against Hunter's
*actual* `espn_credentials.json` file (overwrite-then-delete as part of the test) destroyed his
real cookie values, which had to be re-entered from scratch. Any future local testing of this
script must use an isolated scratch copy, never the user's real working files.

**Pipeline fully validated**: Hunter re-ran `python3 fetch_espn_week.py --season 2025 --week 1`
after the directory fix and it worked cleanly. Cross-checked every single week-1 2025 score in
the generated `matchups.json` against this site's own historically-extracted
`weekly_scores.json` - exact match for all 12 managers (e.g. Conlin 111.66, Palaia 120.38, Zogg
74.48). Standings output also passed a sanity check (Muenchow leading 12-2 matches what the rest
of the site already shows as a strong 2025 season for that manager). Team ID -> manager mapping,
ESPN auth, and the JSON output format are all confirmed correct end-to-end. Deleted the test
output afterward (`data/season_2026/`) since it was 2025 data sitting in the current-season slot -
would've been misleading to leave in place. Next step: build the actual
`pages/season-2026.html` UI against this now-proven data shape.

## Round 12 - Phase 2: season-2026.html built

Built the actual current-season page, with Hunter's explicit requirement that it read as clearly
separate from the historical archive, not just another nav tab blended in.

- New `--live` amber CSS custom property (style.css), used nowhere else on the site - every
  historical page keeps its existing blue/red palette untouched.
- Nav (`shared.js`): "2026 Season" now renders first, amber with a small glowing dot, followed by
  a `.nav-divider` before the historical links start. Verified this doesn't break active-state
  highlighting on any existing page.
- `pages/season-2026.html`: four tabs (Matchups, Standings, Power Rankings, Commentary), each
  amber-accented instead of the site's usual blue tab-active style. Week selectors on Matchups/
  Power Rankings/Commentary (Standings just shows the latest, matching how live standings work).
  Power Rankings and Commentary only render entries with `published: true` - the auto-drafted
  stubs from the fetch script stay invisible until Hunter approves them.
- Added `loadDataSafe()` to shared.js - returns a fallback instead of throwing on a 404, so the
  page shows a real designed empty state ("Check back once the 2026 season kicks off in
  September") instead of erroring when `data/season_2026/` doesn't exist yet.
- Homepage: added a `.season-banner` linking to the page, positioned *above* and visually
  distinct from the "Explore the archive" card grid, not a 7th card mixed into the historical six.
- Verified both states in the browser: real empty state (nothing shipped in `data/season_2026/`),
  and a populated state using temporary sample data (winners highlighted, bye weeks handled, trend
  arrows colored, commentary rendering) - sample data deleted afterward, nothing fake shipped in
  the deliverable. Full site regression pass (all 8 pages, including the new one) came back clean,
  desktop and mobile.

## Round 13 - Real power ranking methodology

Hunter pointed out (correctly) that the "power rankings" the fetch script was drafting weren't
actually power rankings - `cmd_fetch_week()` was just copying the Standings order (wins, then
points-for) into `power_rankings.json` with every trend hardcoded to `"same"` and every blurb
blank. That's a fair miss - the word "rankings" implied a real methodology that wasn't there.

Replaced it with the formula Hunter used in a previous season: a weighted composite of season
win%, normalized season PPG, "expected win%" (all-play luck-adjusted record - each week a team's
score is compared against every other team's score that week, not just their real opponent), and
a 3-game rolling form blend (recent win% + recent normalized PPG). Weights default to 25% each,
adjustable via a `POWER_WEIGHTS` constant at the top of `scripts/fetch_espn_week.py` - no other
code needs to change to retune it.

Implemented as a pure function (`compute_power_rankings(schedule, week, team_map, prev_rankings)`)
so it could be tested without touching real credentials or files - a lesson from the SSL-fix
mistake earlier this session where testing against Hunter's real `espn_credentials.json` destroyed
it. Verified with a constructed 4-team/3-week dataset: a team with a losing record (1-2) but the
league's best scores correctly ranked #1 (high expected wins = bad luck, not bad play), while a
team with the league's best record (2-1) but its worst scores correctly ranked last (low expected
wins = beating weak competition, not playing well) - confirms the luck-adjustment is actually
doing what it's supposed to. Trend arrows (up/down/same) now compare each week's computed rank
against the previous week's computed rank, verified against a simulated prior-week scenario.

Blurbs are still fully data-driven (record, expected record, PPG, recent form) - no generated
opinion or prose. That stays Hunter's call, same as Commentary.

## Round 14 - Nav restructure, weight retune, homepage copy

- **Power ranking weights retuned** per Hunter's preferred emphasis: expected wins 40% (up from
  25%), record 30% (up from 25%), points scored 20% (down from 25%), recent form 10% (down from
  25%). Just a constant change in `POWER_WEIGHTS` - no logic changes needed, confirming the
  earlier design goal of making this a one-line tune.
- **Nav reordered**: Home now comes first, then "2026 Season", then the divider, then the
  historical pages - `Home · 2026 Season | Hall of Fame · Managers · ...`. Previously "2026
  Season" was first with the divider right after it (before Home). Verified active-state
  highlighting still works correctly on both the live section and historical pages after the
  reorder.
- **Homepage scorebug**: replaced "13 managers, all-time" with total points scored across league
  history (250,889, computed client-side as a sum over weekly_scores.json - no new data needed).
- **Homepage subtitle** rewritten from the utilitarian "13 seasons of fantasy football history,
  finally organized" to something with more weight: "Thirteen years of rivalries, dynasties, and
  legendary collapses — every game, every record, every ounce of glory."

## Round 15 - Project relocated out of Downloads

Moved the whole site from `~/Downloads/NWL Handoff/nwl_site/` to `~/nwl_site/` per Hunter's
request (Downloads isn't a sensible permanent home for an active project). Plain directory move -
no file contents changed, including `scripts/espn_credentials.json` which came through intact.
Nothing in the site needed updating: every internal reference (HTML, CSS, JS, the fetch script's
`Path(__file__).resolve().parent`) is relative to the project root or to itself, not the old
absolute path - that was a deliberate design already in place, not a fix needed now. Updated the
local dev-server launch config (`~/.claude/launch.json` and `.devserver.py`, both outside the
shipped site) to point at the new location and verified all 8 pages still load with zero console
errors. The old `~/Downloads/NWL Handoff/` folder still has the original (now superseded)
top-level `HANDOFF.md` and a stale `nwl_site.zip` snapshot - left in place rather than deleted,
since they're Hunter's to clean up if he wants.

## Round 16 - Site is live on GitHub Pages

Talked through hosting options (GitHub Pages vs Netlify vs Vercel/Cloudflare Pages) before doing
anything. Hunter chose: GitHub Pages, public-but-unlisted repo (no real private option on free
tiers - Pages requires a public repo unless paying for GitHub Pro), free `github.io` subdomain
for now.

Setup:
- Installed the GitHub CLI (`gh`) via Homebrew (compiled Go from source as a dependency - took a
  few minutes).
- Set git identity (Hunter Zogg / hunterzogg23@gmail.com), `git init`'d the project (it had never
  been a repo before this).
- Added `__pycache__/` and `.devserver.py` to `.gitignore` alongside the existing
  `espn_credentials.json` exclusion - confirmed via `git status` before every commit that nothing
  sensitive was ever staged.
- Hunter didn't have a GitHub account yet - walked him through creating one, then through the
  `gh auth login --web` device-code flow (two attempts; the first code expired while he was still
  signing up, second one worked).
- `gh repo create nwl_site --public --source=. --remote=origin --push` - created
  github.com/hunterzogg/nwl_site and pushed the initial commit (32 files) in one step.
- Enabled Pages via `gh api repos/hunterzogg/nwl_site/pages` (branch main, path /).
- **Live at https://hunterzogg.github.io/nwl_site/** - verified via curl (200s on every page and
  a data file) and a real browser load (screenshot confirms fonts, logo, and live data all
  render correctly, zero console errors).

**Ongoing publish workflow, from here on**: edit files locally same as always, then
`git add -A && git commit -m "..." && git push` from `~/nwl_site`. GitHub Pages rebuilds
automatically in under a minute. This replaces the zip-file handoff process used everywhere
earlier in this project - REVIEW_LOG.md and HANDOFF.md should keep being updated the same way,
just committed instead of zipped.
