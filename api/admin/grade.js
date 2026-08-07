const { sql } = require('../lib/db');
const { requireAdmin } = require('../lib/session');

// Marks a question's correct option. Grading is a read-time SUM in api/leaderboard.js,
// so this is the only write needed to grade every submitted pick for the question at once.
module.exports = async (req, res) => {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'Admin auth required' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { question_id, correct_option } = req.body || {};
  if (!question_id || !correct_option) {
    return res.status(400).json({ error: 'question_id and correct_option are required' });
  }

  const { rows } = await sql`SELECT type FROM questions WHERE id = ${question_id}`;
  const question = rows[0];
  if (!question) return res.status(404).json({ error: 'Question not found' });

  if (question.type === 'pick_manager') {
    const { rows: mgrRows } = await sql`SELECT 1 FROM managers WHERE name = ${correct_option}`;
    if (!mgrRows.length) return res.status(400).json({ error: 'correct_option must be a valid manager name' });
  } else if (question.type === 'number_guess') {
    if (!Number.isFinite(Number(correct_option))) return res.status(400).json({ error: 'correct_option must be a number' });
  } else if (!['a', 'b'].includes(correct_option)) {
    return res.status(400).json({ error: 'correct_option must be a or b' });
  }

  await sql`UPDATE questions SET correct_option = ${correct_option} WHERE id = ${question_id}`;
  res.status(200).json({ ok: true });
};
