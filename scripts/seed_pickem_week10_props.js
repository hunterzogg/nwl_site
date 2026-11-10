// One-off insert of the Week 10 weekly Pick'em props, drafted with the weekly-espn-update skill.
// Grounded in Week 10's real ESPN lines as of Tuesday (data/season_2026/matchups.json), Weeks 1-9's actual
// highs, Head Coach results and margins, current standings and streaks, and real head-to-head history from
// data/matchup_results.json + this season's matchups.
//
// Inserted with published: false per the skill's two-checkpoint rule. Lines are Tuesday's; re-check them
// after Wednesday's waivers and update the prompt text (never the options) if they moved.
//
// New this week (per Hunter, Nov 10): player props tied to that week's NFL news. Week 10's are built around the
// Nov 10 trade deadline, using traded players who are on NWL rosters, so they're gradable from the box scores
// (appliedStatTotal covers bench players too): Kirk Cousins (Hagan) vs. J.J. McCarthy (Goetz), Keenan Allen
// (Glaser), and Josh Downs (Conlin). Player lines are ESPN's Week 10 projections as of Tuesday.
// Downs to the Chiefs was on NFL.com first; ESPN confirmed it (his team and the KC roster) before the props went live.
//
// The longshot is the week's biggest margin of victory, within 4 (widened from 2 before any picks), plus the closest-guess bonus.
//
// Usage:
//   cd ~/Sites/nwl_site
//   export $(grep -v '^#' .env.local | xargs)
//   node scripts/seed_pickem_week10_props.js

const { sql } = require('../api/lib/db');

const SEASON = 2026;
const WEEK = 10;
const LOCK_AT = '2026-11-12T20:15:00-05:00'; // real Week 10 TNF kickoff (Commanders @ Giants)

const QUESTIONS = [
  {
    type: 'pick_manager',
    prompt: "Which manager scores the most total points in Week 10?",
  },
  {
    type: 'over_under',
    prompt: "Highest individual score in Week 10 - the first 9 weeks' highs were 165.6, 138.9, 132.2, 138.8, 168.2, 114.6, 119.8, 143.3, and 133.6. Chicago, Denver, Philadelphia, and Tampa Bay are on bye.",
    option_a: 'Over 135.5',
    option_b: 'Under 135.5',
  },
  {
    type: 'this_or_that',
    prompt: "Game of the week: Stover (7-2) goes for eight straight at home against Hagan (3-6). Hagan is favored by 6.5 as of Tuesday and leads the all-time series 9-6. Who wins?",
    option_a: 'Stover',
    option_b: 'Hagan',
  },
  {
    type: 'this_or_that',
    prompt: "Muenchow has lost four straight but is favored by 13.5 over Zogg as of Tuesday, the week's biggest spread. Muenchow leads the all-time series 14-5. Does Muenchow cover, winning by more than 13.5?",
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'over_under',
    prompt: "How many started Head Coaches win their NFL game in Week 10? Weeks 1-9 had 7, 8, 5, 7, 5, 5, 7, 7, and 11 (Week 9 was a perfect 11-0). A Head Coach whose team is on bye counts as not started.",
    option_a: 'Over 6.5',
    option_b: 'Under 6.5',
  },
  {
    type: 'this_or_that',
    prompt: "Trade deadline QB swap: the Vikings traded J.J. McCarthy (Goetz) to the Giants in September and traded for Kirk Cousins (Hagan) on Tuesday. Who scores more fantasy points in Week 10? ESPN projects McCarthy for 15.6 and Cousins for 13.0 as of Tuesday. Bench or start doesn't matter, and a player who doesn't play scores 0.",
    option_a: 'J.J. McCarthy',
    option_b: 'Kirk Cousins',
  },
  {
    type: 'over_under',
    prompt: "Keenan Allen (Glaser) was traded from the Colts to the 49ers on Tuesday. How many fantasy points does he score in Week 10? ESPN projects him for 7.1. Bench or start doesn't matter, and 0 counts if he doesn't play.",
    option_a: 'Over 6.5',
    option_b: 'Under 6.5',
  },
  {
    type: 'over_under',
    prompt: "Josh Downs (Conlin), the most-traded player in NWL history (six trades), was traded from the Colts to the Chiefs on Tuesday. How many fantasy points does he score in Week 10? ESPN projected him for 7.4 before the trade. Bench or start doesn't matter, and 0 counts if he doesn't play.",
    option_a: 'Over 7.5',
    option_b: 'Under 7.5',
  },
  {
    type: 'number_guess',
    points: 3,
    tolerance: 4, // widened from 2 on Nov 10, before any picks (per Hunter)
    closest_bonus: 1,
    prompt: "LONGSHOT (3 points): Guess the biggest margin of victory in Week 10. The first 9 weeks' biggest margins were 97.1, 63.3, 59.0, 38.7, 86.3, 31.0, 41.9, 44.5, and 44.5. Within 4 points of the real margin is worth 3 points, and the closest guess gets 1 bonus point, even if it misses by more than 4.",
  },
];

async function main() {
  console.log(`Inserting ${QUESTIONS.length} Week 10 props (week=${WEEK}, season=${SEASON}, lock_at=${LOCK_AT})...\n`);
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
