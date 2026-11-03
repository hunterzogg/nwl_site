// One-off insert of the Week 9 weekly Pick'em props, drafted with the weekly-espn-update skill.
// Grounded in Week 9's real ESPN lines as of Tuesday (data/season_2026/matchups.json), Weeks 1-8's actual
// highs/lows, current standings and streaks, and real head-to-head history from
// data/matchup_results.json + this season's matchups.
//
// Inserted with published: false per the skill's two-checkpoint rule. Lines are Tuesday's; re-check them
// after Wednesday's waivers and update the prompt text (never the options) if they moved.
//
// The longshot is a specific manager's exact score (Stover, on a six-game win streak), within 4 (widened from 3 on Nov 3), plus the
// closest-guess bonus.
//
// Nov 3, before publishing (no picks yet): #89-#91 were three more pick-the-winner props; per Hunter they were
// rewritten as a spread cover, a shotgun count, and a bench pick_manager (a game-total over/under was tried and dropped) so only one prop picks a winner.
//
// Usage:
//   cd ~/Sites/nwl_site
//   export $(grep -v '^#' .env.local | xargs)
//   node scripts/seed_pickem_week9_props.js

const { sql } = require('../api/lib/db');

const SEASON = 2026;
const WEEK = 9;
const LOCK_AT = '2026-11-05T20:15:00-05:00'; // real Week 9 TNF kickoff (Jaguars @ Ravens)

const QUESTIONS = [
  {
    type: 'pick_manager',
    prompt: "Which manager scores the most total points in Week 9?",
  },
  {
    type: 'over_under',
    prompt: "Highest individual score in Week 9 - the first 8 weeks' highs were 165.6, 138.9, 132.2, 138.8, 168.2, 114.6, 119.8, and 143.3. Only Pittsburgh and Tennessee are on bye.",
    option_a: 'Over 135.5',
    option_b: 'Under 135.5',
  },
  {
    type: 'over_under',
    prompt: "Lowest individual score in Week 9 - the first 8 weeks' lows were 68.5, 58.8, 68.8, 73.2, 63.4, 61.1, 70.3, and 67.2.",
    option_a: 'Over 66.5',
    option_b: 'Under 66.5',
  },
  {
    type: 'this_or_that',
    prompt: "Game of the week: Stover (6-2) has won six straight and visits Glaser (6-2). Stover is favored by 6.0 as of Tuesday, but Glaser leads the all-time series 13-7. Who wins?",
    option_a: 'Stover',
    option_b: 'Glaser',
  },
  {
    type: 'this_or_that',
    prompt: "Hagan has lost five straight, and Muenchow has lost three straight. Hagan is favored by 8.0 as of Tuesday, counting the best free-agent Head Coach with Pittsburgh on bye. Does Hagan cover, winning by more than 8.0?",
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'over_under',
    prompt: "Shotguns in Week 9: starters (not Head Coaches) who score 0 or less, injured or not. Weeks 1-8 had 3, 2, 0, 2, 2, 3, 2, and 6. Over or under 2.5?",
    option_a: 'Over 2.5',
    option_b: 'Under 2.5',
  },
  {
    type: 'pick_manager',
    prompt: "Whose bench scores the most total points in Week 9? (Bench only, not IR.) Last week it was Larson's, at 66.3, with Tyler Allgeier (33.6) and Patrick Mahomes (25.4) sitting.",
  },
  {
    type: 'number_guess',
    points: 3,
    tolerance: 4,
    closest_bonus: 1,
    prompt: "LONGSHOT (3 points): Guess Stover's exact score in Week 9. He's projected for 111.7 as of Tuesday, and his eight scores this season ranged from 73.0 to 143.3. Within 4 points of his real score is worth 3 points, and the closest guess gets 1 bonus point, even if it misses by more than 4.",
  },
];

async function main() {
  console.log(`Inserting ${QUESTIONS.length} Week 9 props (week=${WEEK}, season=${SEASON}, lock_at=${LOCK_AT})...\n`);
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
