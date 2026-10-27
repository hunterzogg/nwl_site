// One-off insert of the Week 8 weekly Pick'em props, drafted with the weekly-espn-update skill.
// Grounded in Week 8's real ESPN lines as of Tuesday (data/season_2026/matchups.json), Weeks 1-7's actual
// highs/margins, current standings and streaks, and real head-to-head history from
// data/matchup_results.json + this season's matchups.
//
// Inserted with published: false per the skill's two-checkpoint rule. Lines are Tuesday's; re-check them
// after Wednesday's waivers and update the prompt text (never the options) if they moved.
//
// Oct 27, before publishing (no picks yet): lines were recomputed after fetch_projected_points started filling
// bye-week holes with the top free agent (Hagan has no QB behind Brock Purdy), so #79-#83 below carry the new
// lines, and #82's threshold moved from 30.5 to 12.0. #84 is the first weekly 3-point longshot.
//
// Usage:
//   cd ~/Sites/nwl_site
//   export $(grep -v '^#' .env.local | xargs)
//   node scripts/seed_pickem_week8_props.js

const { sql } = require('../api/lib/db');

const SEASON = 2026;
const WEEK = 8;
const LOCK_AT = '2026-10-29T20:15:00-04:00'; // real Week 8 TNF kickoff (Panthers @ Packers)

const QUESTIONS = [
  {
    type: 'pick_manager',
    prompt: "Which manager scores the most total points in Week 8?",
  },
  {
    type: 'over_under',
    prompt: "Highest individual score in Week 8 - the first 7 weeks' highs were 165.6, 138.9, 132.2, 138.8, 168.2, 114.6, and 119.8. Houston, New Orleans, the Giants, and San Francisco are on bye.",
    option_a: "Over 132.5",
    option_b: "Under 132.5",
  },
  {
    type: 'over_under',
    prompt: "Closest margin of victory in Week 8 - the first 7 weeks were decided by 13.9, 11.9, 2.2, 18.2, 11.9, 4.5, and 4.5. As of Tuesday the closest projected game is Prodahl vs. Muenchow (dead even).",
    option_a: "Over 7.5",
    option_b: "Under 7.5",
  },
  {
    type: 'this_or_that',
    prompt: "Game of the week: #2 Goetz (5-2) vs. #3 Glaser (5-2). As of Tuesday Glaser is favored by 2.0, but Goetz leads the all-time series 12-5. Who wins?",
    option_a: "Goetz",
    option_b: "Glaser",
  },
  {
    type: 'this_or_that',
    prompt: "Stover has won five straight, the longest single-season streak of his career. He's a 24.5-point favorite over Pfaffinger as of Tuesday, the biggest spread of the week, and Pfaffinger has won two straight himself. Does Stover make it six in a row?",
    option_a: "Yes",
    option_b: "No",
  },
  {
    type: 'this_or_that',
    prompt: "Hagan has San Francisco on bye (Christian McCaffrey and Brock Purdy), no other QB on his roster, and four straight losses. Counting the best available free-agent QB (Geno Smith), Palaia is favored by 12.0 as of Tuesday. Does Palaia win by more than 12.0?",
    option_a: "Yes",
    option_b: "No",
  },
  {
    type: 'this_or_that',
    prompt: "Battle of the 2-5s: Conlin vs. Zogg. Zogg is favored by 8.0 as of Tuesday and leads the all-time series 13-10. Only one 2-5 team in league history has made the playoffs (Muenchow, 2023). Who wins?",
    option_a: "Conlin",
    option_b: "Zogg",
  },
  {
    type: 'number_guess',
    points: 3,
    tolerance: 5,
    closest_bonus: 1,
    prompt: "LONGSHOT (3 points): Guess the combined score of Goetz vs. Glaser, the game of the week. It's projected at 213.5 as of Tuesday, and this season's games have totaled anywhere from 142.3 to 259.3. Within 5 points of the real total is worth 3 points, and the closest guess gets 1 bonus point, even if it misses by more than 5.",
  },
];

async function main() {
  console.log(`Inserting ${QUESTIONS.length} Week 8 props (week=${WEEK}, season=${SEASON}, lock_at=${LOCK_AT})...\n`);
  for (const q of QUESTIONS) {
    const { rows } = await sql`
      INSERT INTO questions (week, season, type, prompt, option_a, option_b, points, tolerance, closest_bonus, lock_at, published)
      VALUES (${WEEK}, ${SEASON}, ${q.type}, ${q.prompt}, ${q.option_a || null}, ${q.option_b || null}, ${q.points || 1}, ${q.tolerance || null}, ${q.closest_bonus || null}, ${LOCK_AT}, false)
      RETURNING id
    `;
    console.log(`  #${rows[0].id} [${q.type}] ${q.prompt}`);
  }
  console.log('\nDone. Inserted with published=false - review, then flip live with an UPDATE (see HANDOFF.md) once approved.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
