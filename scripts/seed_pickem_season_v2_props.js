// One-off insert of "Season II" - a second batch of season-long Pick'em props, added because
// only 3 of 12 managers ever submitted picks for the original season-long batch (week = -1,
// locked at Week 1 kickoff before anyone had real data to work with). This batch is grounded in
// what actually happened in Weeks 1-2 (real scores, records, waiver activity) rather than blind
// preseason guesses - the idea being that props tied to real, known storylines are more
// interesting to pick than generic categories. week = -2 is a new bucket, distinct from both
// Draft Day (0) and the original season-long batch (-1), so it can be managed independently via
// the admin page's lock-time tool. See HANDOFF.md for the full research behind each line.
//
// Usage (same pattern as scripts/seed_pickem_season_props.js):
//   cd ~/Sites/nwl_site
//   export $(grep -v '^#' .env.local | xargs)
//   node scripts/seed_pickem_season_v2_props.js

const { sql } = require('../api/lib/db');

const SEASON = 2026;
const WEEK = -2;
const LOCK_AT = '2026-09-27T13:00:00-04:00'; // per explicit request: this Sunday, 1 PM ET (not Week 4 kickoff)

const QUESTIONS = [
  {
    type: 'this_or_that',
    prompt: "Will Ainsworth's regular-season point total break the all-time NWL single-season scoring record (1764.9, set by Goetz in 2018)? Ainsworth's 283.8 through two weeks is already their own career-best start, by 46 points.",
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'this_or_that',
    prompt: "Ainsworth, Glaser, and Larson all started 2-0 - will one of them go on to win the championship? History says it's rare: only 4 of 37 teams that started 2-0 since 2013 won it all, and 13 of those 37 missed the playoffs entirely.",
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'this_or_that',
    prompt: "This year's two hottest starts, head to head - who finishes the regular season with the better record: Ainsworth or Glaser?",
    option_a: 'Ainsworth',
    option_b: 'Glaser',
  },
  {
    type: 'this_or_that',
    prompt: "Larson is 2-0 despite having the league's easiest schedule so far (dead last, 12th of 12, in strength of schedule) - once the slate evens out, will they still make the playoffs (top 6)?",
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'this_or_that',
    prompt: 'Zogg absorbed the biggest Week 1-2 beating in 13 years of NWL history (97.06 points) - will they still make the playoffs (top 6) this season?',
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'this_or_that',
    prompt: "QB has claimed 3x its normal share of the waiver budget this year (37.5% of all FAAB spent vs. a 12.4% historical average), driven by real bidding wars over Tyler Shough and Jared Goff. Will QB still be the single most FAAB-spent position by season's end?",
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'this_or_that',
    prompt: "Ainsworth beat out 4 competing bids (totaling $81 more) to win Tyler Shough for $56 on waivers. Will Tyler Shough finish the season as a top-12 fantasy QB?",
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'over_under',
    prompt: 'Total league-wide FAAB spent this season - the last 3 full-season totals were $1892 (2025), $2251 (2024), and $2065 (2023), a 3-year average of about $2069.',
    option_a: 'Over 2069.5',
    option_b: 'Under 2069.5',
  },
  {
    // Originally a pick_manager "who spends the most FAAB" - changed per explicit correction: with
    // a $200 per-manager cap, multiple managers hitting the ceiling (and therefore tying for
    // "most") is a real, common outcome, not an edge case - confirmed against real history: 5
    // managers hit/exceeded $200 in 2022, 5 in 2024, only 2 in 2023 and 2 in 2025. A single-winner
    // pick doesn't work well against a field that often ties at the top, so this asks how many
    // hit the cap instead, which the $200-average-of-4-seasons line (3.5) already accounts for.
    type: 'over_under',
    prompt: "How many managers will spend their full $200 FAAB budget (or more) by season's end? The cap gets hit more than you'd think - 5 managers hit it in 2022, 5 in 2024, but only 2 in 2023 and 2 in 2025.",
    option_a: 'Over 3.5',
    option_b: 'Under 3.5',
  },
  {
    type: 'this_or_that',
    prompt: "Ainsworth's 97.06-point Week 1 win over Zogg is the biggest season-opening blowout in league history - but not the biggest ever (that's still Conlin's 128-point win over Zogg in 2019). Will an even bigger margin happen later this season?",
    option_a: 'Yes',
    option_b: 'No',
  },
];

async function main() {
  console.log(`Inserting ${QUESTIONS.length} Season II props (week=${WEEK}, season=${SEASON}, lock_at=${LOCK_AT})...\n`);
  for (const q of QUESTIONS) {
    const { rows } = await sql`
      INSERT INTO questions (week, season, type, prompt, option_a, option_b, points, lock_at, published)
      VALUES (${WEEK}, ${SEASON}, ${q.type}, ${q.prompt}, ${q.option_a || null}, ${q.option_b || null}, 3, ${LOCK_AT}, true)
      RETURNING id
    `;
    console.log(`  #${rows[0].id} [${q.type}] ${q.prompt}`);
  }
  console.log('\nDone. Inserted with published=true (live now), points=3 (matching the original season-long batch).');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
