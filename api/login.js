const bcrypt = require('bcryptjs');
const { sql } = require('./lib/db');
const { setManagerSession } = require('./lib/session');

// Self-service accounts: a manager's first successful login sets their password (passcode_hash
// starts NULL after seeding) - no admin-distributed codes needed. Every login after that verifies
// against the hash they set. This is one endpoint doing double duty by design, not two flows,
// so the frontend can use a single "name + password" form regardless of whether it's a first visit.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { manager, password } = req.body || {};
  if (!manager || !password) return res.status(400).json({ error: 'Missing manager or password' });

  const { rows } = await sql`SELECT name, passcode_hash FROM managers WHERE name = ${manager}`;
  const row = rows[0];
  if (!row) return res.status(401).json({ error: 'Unknown manager' });

  if (row.passcode_hash === null) {
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    const hash = await bcrypt.hash(password, 10);
    await sql`UPDATE managers SET passcode_hash = ${hash} WHERE name = ${row.name}`;
    setManagerSession(res, row.name);
    return res.status(200).json({ manager: row.name, claimed: true });
  }

  const ok = await bcrypt.compare(password, row.passcode_hash);
  if (!ok) return res.status(401).json({ error: 'Wrong password' });

  setManagerSession(res, row.name);
  res.status(200).json({ manager: row.name });
};
