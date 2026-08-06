const bcrypt = require('bcryptjs');
const { sql } = require('./lib/db');
const { setManagerSession } = require('./lib/session');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { manager, passcode } = req.body || {};
  if (!manager || !passcode) return res.status(400).json({ error: 'Missing manager or passcode' });

  const { rows } = await sql`SELECT name, passcode_hash FROM managers WHERE name = ${manager}`;
  const row = rows[0];
  if (!row) return res.status(401).json({ error: 'Unknown manager' });

  const ok = await bcrypt.compare(passcode, row.passcode_hash);
  if (!ok) return res.status(401).json({ error: 'Wrong passcode' });

  setManagerSession(res, row.name);
  res.status(200).json({ manager: row.name });
};
