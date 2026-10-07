// One-off insert of the Week 5 weekly Pick'em props, drafted with the weekly-espn-update skill.
// Grounded in Week 5's real ESPN lines (data/season_2026/matchups.json), Weeks 1-4's actual
// highs/margins/totals, the all-time Week 5 scoring record, current standings, and real
// head-to-head history from data/matchup_results.json.
//
// Inserted with published: false per the skill's two-checkpoint rule.
//
// Usage:
//   cd ~/Sites/nwl_site
//   export $(grep -v '^#' .env.local | xargs)
//   node scripts/seed_pickem_week5_props.js

const { sql } = require('../api/lib/db');

const SEASON = 2026;
const WEEK = 5;
const LOCK_AT = '2026-10-08T20:15:00-04:00'; // real Week 5 TNF kickoff (Buccaneers @ Cowboys)

const QUESTIONS = [
  {
    type: 'pick_manager',
    prompt: 'Which manager scores the most total points in Week 5?',
  },
  {
    type: 'over_under',
    prompt: "Highest individual score in Week 5 - the first 4 weeks' highs were 165.56, 138.86, 132.16, and 138.78. The all-time Week 5 record is 175.22, set by Ainsworth in 2021.",
    option_a: 'Over 140.5',
    option_b: 'Under 140.5',
  },
  {
    type: 'over_under',
    prompt: 'Closest margin of victory in Week 5 - the first 4 weeks were decided by 13.94, 11.94, 2.18, and 18.22. ESPN has Glaser vs. Hagan as a 1-point game.',
    option_a: 'Over 10.5',
    option_b: 'Under 10.5',
  },
  {
    type: 'over_under',
    prompt: "Total FAAB spent on winning waiver claims processed Wed 10/7 through Tue 10/13. 2026's three in-season waiver weeks so far cost $96, $140, and $227. The same post-Week 4 waiver week cost $155 in 2023, $172 in 2024, and $204 in 2025.",
    option_a: "Over $170.5",
    option_b: "Under $170.5",
  },
  {
    type: 'over_under',
    prompt: "How many started players (not counting Head Coaches) score exactly 0.0 in Week 5? Weeks 1-4 had 3, 1, 0, and 2. Carolina and Kansas City are on bye.",
    option_a: "Over 1.5",
    option_b: "Under 1.5",
  },
  {
    type: 'over_under',
    prompt: "How many started Head Coaches win their NFL game (+5) in Week 5? Coaches on the bench don't count. Weeks 1-4 had 7, 8, 5, and 7. Carolina and Kansas City are on bye.",
    option_a: "Over 6.5",
    option_b: "Under 6.5",
  },
  {
    type: 'over_under',
    prompt: 'Four teams are tied at 3-1 (Ainsworth, Glaser, Goetz, Larson), and ESPN has three of them as underdogs this week. How many of the four win in Week 5?',
    option_a: 'Over 1.5',
    option_b: 'Under 1.5',
  },
  {
    type: 'this_or_that',
    prompt: 'Will a trade happen in Week 5? The league has completed zero trades through four weeks, despite 34 proposals.',
    option_a: 'Yes',
    option_b: 'No',
  },
];

async function main() {
  console.log(`Inserting ${QUESTIONS.length} Week 5 props (week=${WEEK}, season=${SEASON}, lock_at=${LOCK_AT})...\n`);
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
