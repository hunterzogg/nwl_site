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
const LOCK_AT = '2026-10-01T20:15:00-04:00'; // real Week 4 TNF kickoff (Steelers @ Browns)

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
    prompt: 'Total league-wide FAAB spent this season - the pace so far is way down (only $240 spent through the Week 3 waiver run, vs. $597-$430 through the same point in each of the last 3 seasons), and full-season totals have run $1892-$2251 the last 3 years.',
    option_a: 'Over 1099.5',
    option_b: 'Under 1099.5',
  },
  {
    type: 'pick_manager',
    prompt: 'Which manager ends up spending the most total FAAB dollars this season? (Different from "most transactions" - this is about dollars committed, not move count. Ainsworth leads early at $94.)',
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
