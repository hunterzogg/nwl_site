// One-off insert of the Week 4 weekly Pick'em props. Drafted interactively with Hunter using the
// weekly-espn-update skill's new "draft next week's props" step - grounded in Week 4's own real
// matchup lines (data/season_2026/matchups.json), the last 3 weeks' actual scoring pattern, real
// league history (all-time Week 4 scoring record, the Glaser/Ainsworth head-to-head series, and
// historical 0-3-start Week 4 outcomes), and current standings. Per explicit correction during
// drafting, the trade-history dates originally attached to the trade prop were dropped as too
// noisy - kept the prop itself, cut the context.
//
// Inserted with published: false per the skill's two-checkpoint rule - flip to true only after
// Hunter has actually seen the live rows, not just the chat draft (this script's own run output
// is that first look).
//
// Usage (same pattern as scripts/seed_pickem_week3_props.js):
//   cd ~/Sites/nwl_site
//   export $(grep -v '^#' .env.local | xargs)
//   node scripts/seed_pickem_week4_props.js

const { sql } = require('../api/lib/db');

const SEASON = 2026;
const WEEK = 4;
const LOCK_AT = '2026-10-01T20:15:00-04:00'; // real Week 4 TNF kickoff (Steelers @ Browns)

const QUESTIONS = [
  {
    type: 'pick_manager',
    prompt: 'Which manager scores the most total points in Week 4?',
  },
  {
    type: 'over_under',
    prompt: "Highest individual score in Week 4 - the last 3 weeks' highs were 165.56, 138.86, and 132.16. The all-time Week 4 record is 173.9, set by Palaia in 2019.",
    option_a: 'Over 142.5',
    option_b: 'Under 142.5',
  },
  {
    type: 'over_under',
    prompt: 'Closest margin of victory in Week 4 - the last 3 weeks were decided by 13.94, 11.94, and 2.18.',
    option_a: 'Over 9.5',
    option_b: 'Under 9.5',
  },
  {
    type: 'over_under',
    prompt: "Total combined points scored across all 6 Week 4 games - the sum of this week's own projected matchup totals.",
    option_a: 'Over 1220.5',
    option_b: 'Under 1220.5',
  },
  {
    type: 'this_or_that',
    // Corrected live (UPDATE on id 50) after the ESPN matchup-history rebuild: the original
    // 27 meetings / 15-12 Ainsworth came from the old inferred pairings.
    prompt: "Glaser (3-0, the league's only unbeaten team) hosts Ainsworth in a real rivalry renewal - Ainsworth vs. Glaser is one of the most-played matchups in league history (24 meetings, one behind Conlin vs. Palaia's 25), and the all-time series is dead even at 12-12. Ainsworth took the most recent meeting, a 113.54-112.20 nail-biter in 2025. Who wins?",
    option_a: 'Glaser',
    option_b: 'Ainsworth',
  },
  {
    type: 'this_or_that',
    prompt: "Pfaffinger is 0-3 - will they avoid dropping to 0-4? Historically, teams that start 0-3 have gone exactly 9-9 in their Week 4 game - a true coin flip.",
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'this_or_that',
    prompt: "Will Prodahl cover the week's largest spread, favored by 18 points over Zogg?",
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'this_or_that',
    prompt: 'Will a trade happen in Week 4? The league has completed zero trades through three full weeks this season.',
    option_a: 'Yes',
    option_b: 'No',
  },
];

async function main() {
  console.log(`Inserting ${QUESTIONS.length} Week 4 props (week=${WEEK}, season=${SEASON}, lock_at=${LOCK_AT})...\n`);
  for (const q of QUESTIONS) {
    const { rows } = await sql`
      INSERT INTO questions (week, season, type, prompt, option_a, option_b, points, lock_at, published)
      VALUES (${WEEK}, ${SEASON}, ${q.type}, ${q.prompt}, ${q.option_a || null}, ${q.option_b || null}, 1, ${LOCK_AT}, false)
      RETURNING id
    `;
    console.log(`  #${rows[0].id} [${q.type}] ${q.prompt}`);
  }
  console.log('\nDone. Inserted with published=false - review, then flip live with an UPDATE (see HANDOFF.md) once approved.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
