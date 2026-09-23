// One-off insert of the Week 3 weekly Pick'em props - the first weekly props ever entered (the
// draft-night batch and the season-long batch existed already; weekly props were only ever
// designed/described in the flier before this). Grounded in real data pulled this session:
// - the season's per-week scoring pattern so far (Week 1 high 165.56, Week 2 high 138.86;
//   Week 1 closest margin 13.94, Week 2 closest margin 11.94)
// - Week 3's own computed matchup lines (data/season_2026/matchups.json), which are ESPN's own
//   starting-lineup projected-points totals per team, not a guess
// - the real Week 3 Thursday Night Football kickoff (Falcons @ Packers, 2026-09-25T00:15:00Z /
//   2026-09-24 8:15 PM ET), pulled from ESPN's public scoreboard API
//
// Usage (same pattern as scripts/seed_pickem_season_props.js):
//   cd ~/Sites/nwl_site
//   export $(grep -v '^#' .env.local | xargs)
//   node scripts/seed_pickem_week3_props.js

const { sql } = require('../api/lib/db');

const SEASON = 2026;
const WEEK = 3;
const LOCK_AT = '2026-09-24T20:15:00-04:00'; // real Week 3 TNF kickoff (Falcons @ Packers)

const QUESTIONS = [
  {
    type: 'pick_manager',
    prompt: 'Which manager scores the most total points in Week 3?',
  },
  {
    type: 'over_under',
    prompt: "Highest individual score in Week 3 - Ainsworth's 165.56 was the Week 1 high, Zogg's 138.86 the Week 2 high.",
    option_a: 'Over 152.5',
    option_b: 'Under 152.5',
  },
  {
    type: 'over_under',
    prompt: 'Closest margin of victory in Week 3 - Larson/Prodahl was decided by 13.94 in Week 1, Prodahl/Stover by 11.94 in Week 2.',
    option_a: 'Over 12.5',
    option_b: 'Under 12.5',
  },
  {
    type: 'over_under',
    prompt: 'Total combined points scored across all 6 Week 3 games - the sum of this week’s own projected matchup totals.',
    option_a: 'Over 1223.5',
    option_b: 'Under 1223.5',
  },
  {
    type: 'this_or_that',
    prompt: "Will Ainsworth cover the week's largest spread, favored by 25 points over Stover?",
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'over_under',
    prompt: "Will Goetz/Prodahl - the week's highest projected total at 211.5 - go over that number?",
    option_a: 'Over 211.5',
    option_b: 'Under 211.5',
  },
  {
    // Edited post-insert (question id 35) - Larson and Glaser are the only two 2-0 teams in the
    // league and happen to play each other in Week 3, so this replaced the original underdog
    // prop below to spotlight that matchup instead. Kept here so the script matches what's
    // actually live; the original idea is preserved in a comment in case it's useful later:
    //   prompt: 'Will any Week 3 underdog (by the projected line) pull off the upset?',
    //   option_a: 'Yes', option_b: 'No',
    type: 'this_or_that',
    prompt: "Week 3's only unbeaten-vs-unbeaten matchup: who stays perfect?",
    option_a: 'Larson',
    option_b: 'Glaser',
  },
];

async function main() {
  console.log(`Inserting ${QUESTIONS.length} Week 3 props (week=${WEEK}, season=${SEASON}, lock_at=${LOCK_AT})...\n`);
  for (const q of QUESTIONS) {
    const { rows } = await sql`
      INSERT INTO questions (week, season, type, prompt, option_a, option_b, points, lock_at, published)
      VALUES (${WEEK}, ${SEASON}, ${q.type}, ${q.prompt}, ${q.option_a || null}, ${q.option_b || null}, 1, ${LOCK_AT}, true)
      RETURNING id
    `;
    console.log(`  #${rows[0].id} [${q.type}] ${q.prompt}`);
  }
  console.log('\nDone. Inserted with published=true (live now) - edit/unpublish in pickem-admin.html if any line needs adjusting before lock.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
