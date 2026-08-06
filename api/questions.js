const { sql } = require('./lib/db');

// Public: returns published questions for a given week (default: all published, most recent week first).
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const week = req.query.week;
  const rows = week
    ? (await sql`SELECT id, week, season, type, prompt, option_a, option_b, points, lock_at, correct_option
                 FROM questions WHERE published = true AND week = ${week} ORDER BY id`).rows
    : (await sql`SELECT id, week, season, type, prompt, option_a, option_b, points, lock_at, correct_option
                 FROM questions WHERE published = true ORDER BY week DESC, id`).rows;

  res.status(200).json(rows);
};
