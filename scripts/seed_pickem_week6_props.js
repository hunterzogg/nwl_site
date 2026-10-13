// One-off insert of the Week 6 weekly Pick'em props, drafted with the weekly-espn-update skill.
// Grounded in Week 6's real ESPN lines (data/season_2026/matchups.json), Weeks 1-5's actual
// highs/margins/totals, current standings, and real
// head-to-head history from data/matchup_results.json.
//
// Inserted with published: false per the skill's two-checkpoint rule.
//
// Usage:
//   cd ~/Sites/nwl_site
//   export $(grep -v '^#' .env.local | xargs)
//   node scripts/seed_pickem_week6_props.js

const { sql } = require('../api/lib/db');

const SEASON = 2026;
const WEEK = 6;
const LOCK_AT = '2026-10-15T20:15:00-04:00'; // real Week 6 TNF kickoff (Seahawks @ Broncos)

const QUESTIONS = [
  {
    type: 'pick_manager',
    prompt: "Which manager scores the most total points in Week 6?",
  },
  {
    type: 'over_under',
    prompt: "Highest individual score in Week 6 - the first 5 weeks' highs were 165.56, 138.86, 132.16, 138.78, and 168.22.",
    option_a: "Over 145.5",
    option_b: "Under 145.5",
  },
  {
    type: 'over_under',
    prompt: "Closest margin of victory in Week 6 - the first 5 weeks were decided by 13.94, 11.94, 2.18, 18.22, and 11.90. The closest projected game is Palaia vs. Goetz (3.5).",
    option_a: "Over 10.5",
    option_b: "Under 10.5",
  },
  {
    type: 'this_or_that',
    prompt: "#4 Muenchow, coming off a 168.22 (the highest score in the league since 2022), hosts #2 Ainsworth. Based on each team's best projected lineup, Ainsworth is favored by 9.5, but Muenchow leads the all-time series 12-7. Who wins?",
    option_a: "Muenchow",
    option_b: "Ainsworth",
  },
  {
    type: 'this_or_that',
    prompt: "Pfaffinger is 0-5. Will he fall to 0-6 against Conlin, who is favored by 12.5? Conlin leads that series 11-10. Only two teams have ever started 0-6: Larson (2015) and Goetz (2025).",
    option_a: "Yes",
    option_b: "No",
  },
  {
    type: 'over_under',
    prompt: "Zogg's Week 6 score - so far: 68.50, 138.86, 68.84, 121.10, 69.84. Zogg's best projected lineup against Glaser is 82.0.",
    option_a: "Over 81.5",
    option_b: "Under 81.5",
  },
  {
    type: 'this_or_that',
    prompt: "Brock Purdy has outscored Jalen Hurts from Hagan's bench three weeks in a row (28.0 points total). Does Hagan start Purdy at QB in Week 6?",
    option_a: "Yes",
    option_b: "No",
  },
  {
    type: 'this_or_that',
    prompt: "Will a trade happen in Week 6? Still zero trades through five weeks.",
    option_a: "Yes",
    option_b: "No",
  },
];

async function main() {
  console.log(`Inserting ${QUESTIONS.length} Week 6 props (week=${WEEK}, season=${SEASON}, lock_at=${LOCK_AT})...\n`);
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
