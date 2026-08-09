// One-off insert of the 2026 season-long Pick'em prop questions (standings/scoring/transactions/
// novelty props, as opposed to the draft-night questions or weekly props). All lock at Week 1
// kickoff and stay ungraded until the season wraps - see HANDOFF.md's "brainstorming ideas for
// the next round of Pick'em" session for the full reasoning behind each prop and its line.
//
// week = -1 is a new bucket distinct from week 0 (Draft Day) and the real weekly props (1-17),
// so these can be bulk-managed (lock time, publish) independently of both.
//
// Safe to re-run only in the sense that re-running will insert a SECOND copy of every question
// (no ON CONFLICT guard, unlike scripts/seed_managers.js) - there's no natural unique key to
// dedupe on (prompt text could legitimately change). Check `select id, prompt from questions
// where week = -1` before re-running if unsure whether this has already been run.
//
// Usage:
//   cd ~/Sites/nwl_site
//   vercel env pull .env.local          # if not already pulled
//   export $(grep -v '^#' .env.local | xargs)
//   node scripts/seed_pickem_season_props.js

const { sql } = require('../api/lib/db');

const SEASON = 2026;
const WEEK = -1;
const LOCK_AT = '2026-09-09T20:20:00-04:00'; // Week 1 kickoff, 8:20 PM ET

const QUESTIONS = [
  {
    type: 'pick_manager',
    prompt: 'Who will win the 2026 NWL Championship?',
  },
  {
    type: 'pick_manager',
    prompt: "Who will finish as this year's Sacko (last place)?",
  },
  {
    type: 'over_under',
    prompt: 'Most regular-season wins by a single manager - Muenchow led with 12 wins last year, but the previous 2 seasons the highest was only 9 and 10 wins.',
    option_a: 'Over 10.5',
    option_b: 'Under 10.5',
  },
  {
    type: 'over_under',
    prompt: 'Most total points scored, regular season - Muenchow led with 1619.1 points last year.',
    option_a: 'Over 1618.5',
    option_b: 'Under 1618.5',
  },
  {
    type: 'over_under',
    prompt: "Highest single-game score of the season - last year's high was 161.2 (Larson).",
    option_a: 'Over 159.5',
    option_b: 'Under 159.5',
  },
  {
    type: 'pick_manager',
    prompt: 'Which manager will rack up the most total transactions this season?',
  },
  {
    type: 'over_under',
    prompt: 'Total trades league-wide this season - 27 trades happened last year.',
    option_a: 'Over 17.5',
    option_b: 'Under 17.5',
  },
  {
    type: 'over_under',
    prompt: "Widest margin of victory in a single matchup this season - last year's widest margin was 101 points.",
    option_a: 'Over 83.5',
    option_b: 'Under 83.5',
  },
  {
    type: 'this_or_that',
    prompt: 'Will any regular-season matchup be decided by under 0.5 points?',
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'over_under',
    prompt: "Lowest score to still win a matchup this season - last year's lowest winning score was 66.",
    option_a: 'Over 72.5',
    option_b: 'Under 72.5',
  },
  {
    type: 'this_or_that',
    prompt: 'Will any manager go winless across a full calendar month this season?',
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'this_or_that',
    prompt: 'Will an undrafted or late-round waiver pickup finish as a top-12 player at their position this season?',
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'this_or_that',
    prompt: 'Will a manager voluntarily bench a player they drafted in the first 3 rounds for a full game (not injury/bye-related)?',
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'this_or_that',
    prompt: 'Will any manager start the season either 4-0 or 0-4?',
    option_a: 'Yes',
    option_b: 'No',
  },
  {
    type: 'number_guess',
    prompt: 'How many different starting QBs will be used league-wide, across all teams, all season?',
  },
  {
    type: 'over_under',
    prompt: 'Most FAAB spent on a single waiver pickup this season.',
    option_a: 'Over 74.5',
    option_b: 'Under 74.5',
  },
];

async function main() {
  console.log(`Inserting ${QUESTIONS.length} season-long props (week=${WEEK}, season=${SEASON}, lock_at=${LOCK_AT})...\n`);
  for (const q of QUESTIONS) {
    const { rows } = await sql`
      INSERT INTO questions (week, season, type, prompt, option_a, option_b, points, lock_at, published)
      VALUES (${WEEK}, ${SEASON}, ${q.type}, ${q.prompt}, ${q.option_a || null}, ${q.option_b || null}, 1, ${LOCK_AT}, false)
      RETURNING id
    `;
    console.log(`  #${rows[0].id} [${q.type}] ${q.prompt}`);
  }
  console.log('\nDone. All inserted with published=false - flip each to true in pickem-admin.html once ready to go live.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
