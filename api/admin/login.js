const { setAdminSession } = require('../lib/session');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { passcode } = req.body || {};
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected) return res.status(500).json({ error: 'ADMIN_PASSCODE not configured' });
  if (passcode !== expected) return res.status(401).json({ error: 'Wrong passcode' });

  setAdminSession(res);
  res.status(200).json({ ok: true });
};
