// One-off insert of the Week 7 weekly Pick'em props, drafted with the weekly-espn-update skill.
// Grounded in Week 7's real ESPN lines (data/season_2026/matchups.json), Weeks 1-6's actual
// highs/margins, current standings and streaks, and real head-to-head history from
// data/matchup_results.json + this season's schedule.json.
//
// Inserted with published: false per the skill's two-checkpoint rule.
//
// Usage:
//   cd ~/Sites/nwl_site
//   export $(grep -v '^#' .env.local | xargs)
//   node scripts/seed_pickem_week7_props.js

const { sql } = require('../api/lib/db');

const SEASON = 2026;
const WEEK = 7;
const LOCK_AT = '2026-10-22T20:15:00-04:00'; // real Week 7 TNF kickoff (Patriots @ Bears)

const QUESTIONS = [
  {
    type: 'pick_manager',
    prompt: "Which manager scores the most total points in Week 7?",
  },
  {
    type: 'over_under',
    prompt: "Highest individual score in Week 7 - the first 6 weeks' highs were 165.56, 138.86, 132.16, 138.78, 168.22, and 114.60.",
    option_a: "Over 137.5",
    option_b: "Under 137.5",
  },
  {
    type: 'over_under',
    prompt: "Closest margin of victory in Week 7 - the first 6 weeks were decided by 13.94, 11.94, 2.18, 18.22, 11.90, and 4.52. The closest projected game is Hagan vs. Goetz (Goetz by 0.5).",
    option_a: "Over 8.5",
    option_b: "Under 8.5",
  },
  {
    type: 'this_or_that',
    prompt: "Game of the week: #1 Ainsworth (5-1) vs. #5 Prodahl (3-3), the highest projected game of the week (224.0). Prodahl is favored by 1.0 and leads the all-time series 14-2. Who wins?",
    option_a: "Ainsworth",
    option_b: "Prodahl",
  },
  {
    type: 'this_or_that',
    prompt: "Conlin has Buffalo on bye (Josh Allen and James Cook III), and Larson is favored by 26.5, the biggest spread of the week. Does Larson win by more than 26.5?",
    option_a: "Yes",
    option_b: "No",
  },
  {
    type: 'this_or_that',
    prompt: "Stover has won four straight, the longest active streak in the league. He's favored by 2.5 over Muenchow, who leads their all-time series 8-7. Does Stover make it five in a row?",
    option_a: "Yes",
    option_b: "No",
  },
  {
    type: 'this_or_that',
    prompt: "Pfaffinger finally won in Week 6. Can he win two straight? He's favored by 1.0 over Glaser (5-1) and leads their all-time series 13-6.",
    option_a: "Yes",
    option_b: "No",
  },
];

async function main() {
  console.log(`Inserting ${QUESTIONS.length} Week 7 props (week=${WEEK}, season=${SEASON}, lock_at=${LOCK_AT})...\n`);
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
