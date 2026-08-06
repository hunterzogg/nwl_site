const { sql } = require('./lib/db');
const { getManagerSession } = require('./lib/session');

module.exports = async (req, res) => {
  const manager = getManagerSession(req);
  if (!manager) return res.status(401).json({ error: 'Not logged in' });

  if (req.method === 'GET') {
    const week = req.query.week;
    const rows = week
      ? (await sql`SELECT question_id, choice FROM picks WHERE manager = ${manager}
                   AND question_id IN (SELECT id FROM questions WHERE week = ${week})`).rows
      : (await sql`SELECT question_id, choice FROM picks WHERE manager = ${manager}`).rows;
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    const { question_id, choice } = req.body || {};
    if (!question_id || !['a', 'b'].includes(choice)) {
      return res.status(400).json({ error: 'question_id and choice (a|b) are required' });
    }

    const { rows } = await sql`SELECT lock_at, published FROM questions WHERE id = ${question_id}`;
    const question = rows[0];
    if (!question || !question.published) return res.status(404).json({ error: 'Question not found' });
    if (new Date(question.lock_at) <= new Date()) {
      return res.status(403).json({ error: 'This question has locked - picks are closed' });
    }

    await sql`
      INSERT INTO picks (manager, question_id, choice)
      VALUES (${manager}, ${question_id}, ${choice})
      ON CONFLICT (manager, question_id) DO UPDATE SET choice = ${choice}, submitted_at = now()
    `;
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
