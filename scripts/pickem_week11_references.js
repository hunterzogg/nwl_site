// One-off (Nov 17, per Hunter): move Week 11's lists of past-week numbers and fine print out of the prompts and
// into the new `reference` column, which the Pick'em page shows as a small label + "W1 68.5" chips + note under
// the question. Run once the deploy that adds `reference` to api/questions.js is live, or the numbers would
// briefly disappear from the live page. Only prompt text and reference change; options and lines don't.
//
// Usage:
//   cd ~/Sites/nwl_site
//   export $(grep -v '^#' .env.local | xargs)
//   node scripts/pickem_week11_references.js

const { sql } = require('../server_lib/db');

const fine = "Bench or start doesn't matter, and 0 counts if he doesn't play.";
const UPDATES = {
  103: {
    prompt: "Lowest individual score in Week 11. Six NFL teams are on bye: Atlanta, Cleveland, Green Bay, the Rams, New England, and Seattle.",
    reference: { label: 'Lowest score by week', values: [68.5, 58.8, 68.8, 73.2, 63.4, 61.1, 70.3, 67.2, 57.6, 73.5] },
  },
  104: {
    prompt: "Game of the week: Glaser (7-3) visits Conlin (3-7), and Conlin is favored by 4.5. Who wins?",
    reference: { note: "Line as of Tuesday. Glaser leads the all-time series 9-7." },
  },
  105: {
    prompt: "Ainsworth is favored by 13.5 over Hagan, who just scored 153.6, his best since at least 2022. Does Ainsworth win by more than 13.5?",
    reference: { note: 'Line as of Tuesday.' },
  },
  106: {
    prompt: "How many teams score 120 or more in Week 11?",
    reference: { label: '120+ scores by week', values: [4, 1, 2, 3, 3, 0, 0, 1, 2, 3] },
  },
  107: {
    prompt: "David Montgomery (Ainsworth) is expected back from a groin injury for Thursday night's Colts-Texans game. How many fantasy points does he score?",
    reference: { note: `ESPN projects 12.8. ${fine}` },
  },
  108: {
    prompt: "Mike Evans (Muenchow) is questionable as he works back from an Achilles injury. How many fantasy points does he score?",
    reference: { note: `ESPN projects 10.0. ${fine}` },
  },
  109: {
    prompt: "Brock Bowers (Palaia) is day-to-day with an ankle injury after scoring 2.8 in Week 10. How many fantasy points does he score?",
    reference: { note: `ESPN projects 12.3. ${fine}` },
  },
  110: {
    prompt: "LONGSHOT (3 points): Guess the league-wide total points in Week 11, all 12 teams combined.",
    reference: {
      label: 'League total by week',
      values: ['1,311.7', '1,112.0', '1,188.4', '1,212.5', '1,245.1', '1,078.3', '1,145.6', '1,155.9', '1,147.0', '1,271.8'],
      // no note: the guess box already says "within ±15 counts · closest guess +1"
    },
  },
};

(async () => {
  for (const [id, u] of Object.entries(UPDATES)) {
    const { rows } = await sql`UPDATE questions SET prompt = ${u.prompt}, reference = ${JSON.stringify(u.reference)}::jsonb
      WHERE id = ${Number(id)} AND week = 11 AND season = 2026 RETURNING id`;
    console.log(rows.length ? `updated #${id}` : `#${id} not found`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
