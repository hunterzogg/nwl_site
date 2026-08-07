const { sql } = require('../lib/db');
const { requireAdmin } = require('../lib/session');

// The friends-league equivalent of "forgot password": no email flow, Hunter just clears the
// hash back to NULL so the manager's next login re-claims the account with a new password.
module.exports = async (req, res) => {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'Admin auth required' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { manager } = req.body || {};
  if (!manager) return res.status(400).json({ error: 'manager is required' });

  const { rows } = await sql`SELECT name FROM managers WHERE name = ${manager}`;
  if (!rows.length) return res.status(404).json({ error: 'Unknown manager' });

  await sql`UPDATE managers SET passcode_hash = NULL WHERE name = ${manager}`;
  res.status(200).json({ ok: true });
};
