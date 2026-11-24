// Pick'em operations for GitHub Actions (.github/workflows/pickem-ops.yml), so the weekly Pick'em work can run
// without anyone's laptop. The database URL comes from the POSTGRES_URL repo secret; nothing here reads or types the
// ADMIN_PASSCODE. Nothing writes to the database unless a person starts the workflow by hand.
//
//   node scripts/pickem_ops.js snapshot            -> data/season_2026/pickem_snapshot.json  (read-only)
//   node scripts/pickem_ops.js grade               <- data/season_2026/pickem_grades.json
//   node scripts/pickem_ops.js seed                <- data/season_2026/pickem_props_pending.json
//   node scripts/pickem_ops.js publish --week N    flips the week's unpublished questions live
//
// pickem_grades.json:   {"grades": [{"id": 123, "correct_option": "a"}, {"id": 124, "correct_option": "Ainsworth"}, {"id": 125, "correct_option": "212"}]}
// pickem_props_pending.json:
//   {"season": 2026, "week": 12, "lock_at": "2026-11-26T12:30:00-05:00",
//    "questions": [{"type": "over_under", "prompt": "...", "option_a": "Over 62.5", "option_b": "Under 62.5",
//                   "points": 1, "tolerance": null, "closest_bonus": null, "reference": null}]}
// Every new question is inserted with published = false. A grade only fills a question that has no grade yet,
// unless the file sets "overwrite": true.
//
// The snapshot is committed to a public repo, so it lists individual picks only for questions that are already locked
// (picks are visible on the site by then); open questions only get a pick count.

const fs = require('fs');
const path = require('path');
const { sql } = require('../server_lib/db');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'season_2026');

async function snapshot() {
  const q = await sql`SELECT * FROM questions ORDER BY week, id`;
  const picks = await sql`SELECT manager, question_id, choice, submitted_at FROM picks ORDER BY question_id, manager`;
  const now = Date.now();
  const byQ = new Map();
  for (const p of picks.rows) {
    if (!byQ.has(p.question_id)) byQ.set(p.question_id, []);
    byQ.get(p.question_id).push(p);
  }
  const questions = q.rows.map((row) => {
    const list = byQ.get(row.id) || [];
    const locked = new Date(row.lock_at).getTime() <= now;
    const out = { ...row, pick_count: list.length, locked };
    if (locked) out.picks = list.map((p) => ({ manager: p.manager, choice: p.choice }));
    return out;
  });
  const file = path.join(DATA, 'pickem_snapshot.json');
  fs.writeFileSync(file, JSON.stringify({ generated_at: new Date().toISOString(), questions }, null, 2) + '\n');
  console.log(`Wrote ${questions.length} questions to ${path.relative(ROOT, file)}`);
}

async function grade() {
  const file = path.join(DATA, 'pickem_grades.json');
  const { grades, overwrite } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(grades) || !grades.length) throw new Error('pickem_grades.json has no grades');
  for (const g of grades) {
    if (!Number.isInteger(g.id) || g.correct_option == null || g.correct_option === '') {
      throw new Error('Bad grade entry: ' + JSON.stringify(g));
    }
    const res = overwrite
      ? await sql`UPDATE questions SET correct_option = ${String(g.correct_option)} WHERE id = ${g.id} RETURNING id`
      : await sql`UPDATE questions SET correct_option = ${String(g.correct_option)} WHERE id = ${g.id} AND correct_option IS NULL RETURNING id`;
    console.log(`question ${g.id} -> ${g.correct_option}: ${res.rowCount ? 'graded' : 'skipped (missing or already graded)'}`);
  }
}

async function seed() {
  const file = path.join(DATA, 'pickem_props_pending.json');
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { season, week, lock_at, questions } = spec;
  if (!season || !week || !lock_at || !Array.isArray(questions) || !questions.length) {
    throw new Error('pickem_props_pending.json needs season, week, lock_at and questions');
  }
  for (const q of questions) {
    const dup = await sql`SELECT id FROM questions WHERE season = ${season} AND week = ${week} AND prompt = ${q.prompt}`;
    if (dup.rowCount) { console.log(`skip (already exists as ${dup.rows[0].id}): ${q.prompt.slice(0, 60)}`); continue; }
    const r = await sql`
      INSERT INTO questions (week, season, type, prompt, option_a, option_b, points, tolerance, closest_bonus, lock_at, published, reference)
      VALUES (${week}, ${season}, ${q.type}, ${q.prompt}, ${q.option_a ?? null}, ${q.option_b ?? null}, ${q.points ?? 1},
              ${q.tolerance ?? null}, ${q.closest_bonus ?? null}, ${lock_at}, false, ${q.reference ?? null})
      RETURNING id`;
    console.log(`inserted ${r.rows[0].id} (unpublished): ${q.prompt.slice(0, 60)}`);
  }
}

// update: rewrite the prompt/reference of existing questions from data/season_2026/pickem_updates.json
// ({"updates":[{"id":N,"prompt":"...","reference":{...}}]}). Only unlocked questions are touched.
async function update() {
  const spec = JSON.parse(fs.readFileSync(path.join(DATA, 'pickem_updates.json'), 'utf8'));
  for (const u of spec.updates || []) {
    // Never rewrite a locked question, or one that already has picks, unless the update sets "force": true (for wording-only
    // edits that don't change what is being asked).
    const r = await sql`
      UPDATE questions SET prompt = ${u.prompt}, reference = ${u.reference ?? null},
             tolerance = COALESCE(${u.tolerance ?? null}, tolerance), closest_bonus = COALESCE(${u.closest_bonus ?? null}, closest_bonus)
      WHERE id = ${u.id} AND lock_at > now() AND (${u.force === true} OR NOT EXISTS (SELECT 1 FROM picks WHERE question_id = ${u.id}))
      RETURNING id`;
    console.log(`question ${u.id}: ${r.rowCount ? 'updated' : 'skipped (missing, locked, or already has picks)'}`);
  }
}

async function publish(week) {
  if (!week) throw new Error('publish needs --week N');
  const r = await sql`UPDATE questions SET published = true WHERE week = ${week} AND season = 2026 AND published = false RETURNING id`;
  console.log(`published ${r.rowCount} questions for week ${week}: ${r.rows.map((x) => x.id).join(', ')}`);
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const wi = rest.indexOf('--week');
  const week = wi >= 0 ? parseInt(rest[wi + 1], 10) : null;
  if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL is not set (add it as a GitHub repo secret)');
  if (cmd === 'snapshot') await snapshot();
  else if (cmd === 'grade') await grade();
  else if (cmd === 'seed') await seed();
  else if (cmd === 'publish') await publish(week);
  else if (cmd === 'update') await update();
  else throw new Error('usage: pickem_ops.js snapshot | grade | seed | publish --week N | update');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
