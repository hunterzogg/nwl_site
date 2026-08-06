const { sql } = require('../lib/db');
const { requireAdmin } = require('../lib/session');

module.exports = async (req, res) => {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'Admin auth required' });

  if (req.method === 'GET') {
    const week = req.query.week;
    const rows = week
      ? (await sql`SELECT * FROM questions WHERE week = ${week} ORDER BY id`).rows
      : (await sql`SELECT * FROM questions ORDER BY week DESC, id`).rows;
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    const { week, season, type, prompt, option_a, option_b, points, lock_at } = req.body || {};
    if (!week || !type || !prompt || !option_a || !option_b || !lock_at) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const { rows } = await sql`
      INSERT INTO questions (week, season, type, prompt, option_a, option_b, points, lock_at, published)
      VALUES (${week}, ${season || 2026}, ${type}, ${prompt}, ${option_a}, ${option_b}, ${points || 1}, ${lock_at}, false)
      RETURNING id
    `;
    return res.status(201).json({ id: rows[0].id });
  }

  if (req.method === 'PUT') {
    const { id, published } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });
    await sql`UPDATE questions SET published = ${!!published} WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
