const { sql } = require('../lib/db');
const { requireAdmin } = require('../lib/session');

// Marks a question's correct option. Grading is a read-time SUM in api/leaderboard.js,
// so this is the only write needed to grade every submitted pick for the question at once.
module.exports = async (req, res) => {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'Admin auth required' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { question_id, correct_option } = req.body || {};
  if (!question_id || !['a', 'b'].includes(correct_option)) {
    return res.status(400).json({ error: 'question_id and correct_option (a|b) are required' });
  }

  await sql`UPDATE questions SET correct_option = ${correct_option} WHERE id = ${question_id}`;
  res.status(200).json({ ok: true });
};
