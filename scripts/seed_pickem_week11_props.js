// One-off insert of the Week 11 weekly Pick'em props, drafted with the weekly-espn-update skill.
// Grounded in Week 11's real ESPN lines as of Tuesday (data/season_2026/matchups.json), Weeks 1-10's actual
// lows, 120+ counts and league totals, current standings, and real head-to-head history from
// data/matchup_results.json + this season's matchups. Lines were set near 50/50 with a 100,000-week simulation of
// Tuesday's projections.
//
// Inserted with published: false per the skill's two-checkpoint rule. Lines are Tuesday's; re-check them
// after Wednesday's waivers and update the prompt text (never the options) if they moved.
//
// Player props tied to the week's NFL news (per Hunter, Nov 10): three injured players on NWL rosters with uncertain
// returns, gradable from the box scores (bench players have appliedStatTotal too): David Montgomery (Ainsworth),
// returning from a groin injury Thursday night; Mike Evans (Muenchow), questionable coming back from an Achilles
// injury; and Brock Bowers (Palaia), day-to-day with an ankle injury. Lines sit a bit under ESPN's Tuesday
// projections to account for the chance each player sits.
//
// Nov 17: prompts shortened after insert; past-week lists and fine print moved to the new `reference` column by
// scripts/pickem_week11_references.js. Next week's seed should set `reference` on each question directly (the insert
// below already writes it).
//
// The longshot is league-wide total points for the week, within 30 (widened from 15 before any picks), plus the closest-guess bonus.
//
// Usage:
//   cd ~/Sites/nwl_site
//   export $(grep -v '^#' .env.local | xargs)
//   node scripts/seed_pickem_week11_props.js

const { sql } = require('../api/lib/db');

const SEASON = 2026;
const WEEK = 11;
const LOCK_AT = '2026-11-19T20:15:00-05:00'; // real Week 11 TNF kickoff (Colts @ Texans)

const QUESTIONS = [
  {
    type: 'pick_manager',
    prompt: "Which manager scores the most total points in Week 11?",
  },
  {
    type: 'over_under',
    prompt: "Lowest individual score in Week 11 - the first 10 weeks' lows were 68.5, 58.8, 68.8, 73.2, 63.4, 61.1, 70.3, 67.2, 57.6, and 73.5. Six NFL teams are on bye: Atlanta, Cleveland, Green Bay, the Rams, New England, and Seattle.",
    option_a: 'Over 62.5',
    option_b: 'Under 62.5',
  },
  {
    type: 'this_or_that',
    prompt: "Game of the week: Glaser (7-3) visits Conlin (3-7), and Conlin is favored by 4.5 as of Tuesday. Glaser leads the all-time series 9-7. Who wins?",
    option_a: 'Glaser',
    option_b: 'Conlin',
  },
  {
    type: 'this_or_that',
    prompt: "Ainsworth is favored by 13.5 over Hagan as of Tuesday. Hagan just scored 153.6, his best since at least 2022. Does Ainsworth cover, winning by more than 13.5?",
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'over_under',
    prompt: "How many teams score 120 or more in Week 11? Weeks 1-10 had 4, 1, 2, 3, 3, 0, 0, 1, 2, and 3.",
    option_a: 'Over 2.5',
    option_b: 'Under 2.5',
  },
  {
    type: 'over_under',
    prompt: "David Montgomery (Ainsworth) is expected back from a groin injury for Thursday night's Colts-Texans game. How many fantasy points does he score in Week 11? ESPN projects him for 12.8. Bench or start doesn't matter, and 0 counts if he doesn't play.",
    option_a: 'Over 10.5',
    option_b: 'Under 10.5',
  },
  {
    type: 'over_under',
    prompt: "Mike Evans (Muenchow) is questionable as he works back from an Achilles injury. How many fantasy points does he score in Week 11? ESPN projects him for 10.0. Bench or start doesn't matter, and 0 counts if he doesn't play.",
    option_a: 'Over 6.5',
    option_b: 'Under 6.5',
  },
  {
    type: 'over_under',
    prompt: "Brock Bowers (Palaia) is day-to-day with an ankle injury after scoring 2.8 in Week 10. How many fantasy points does he score in Week 11? ESPN projects him for 12.3. Bench or start doesn't matter, and 0 counts if he doesn't play.",
    option_a: 'Over 9.5',
    option_b: 'Under 9.5',
  },
  {
    type: 'number_guess',
    points: 3,
    tolerance: 30, // widened from 15 on Nov 17, before any picks (per Hunter)
    closest_bonus: 1,
    prompt: "LONGSHOT (3 points): Guess the league-wide total points in Week 11, all 12 teams combined. The first 10 weeks' totals were 1,311.7, 1,112.0, 1,188.4, 1,212.5, 1,245.1, 1,078.3, 1,145.6, 1,155.9, 1,147.0, and 1,271.8. Within 30 points of the real total is worth 3 points, and the closest guess gets 1 bonus point, even if it misses by more than 30.",
  },
];

async function main() {
  console.log(`Inserting ${QUESTIONS.length} Week 11 props (week=${WEEK}, season=${SEASON}, lock_at=${LOCK_AT})...\n`);
  for (const q of QUESTIONS) {
    const { rows } = await sql`
      INSERT INTO questions (week, season, type, prompt, reference, option_a, option_b, points, tolerance, closest_bonus, lock_at, published)
      VALUES (${WEEK}, ${SEASON}, ${q.type}, ${q.prompt}, ${q.reference ? JSON.stringify(q.reference) : null}::jsonb, ${q.option_a || null}, ${q.option_b || null}, ${q.points || 1}, ${q.tolerance || null}, ${q.closest_bonus || null}, ${LOCK_AT}, false)
      RETURNING id
    `;
    console.log(`  #${rows[0].id} [${q.type}] ${q.prompt}`);
  }
  console.log('\nDone. Inserted with published=false - review, then flip live with an UPDATE (see HANDOFF.md) once approved.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
