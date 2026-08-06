const { clearManagerSession } = require('./lib/session');

module.exports = async (req, res) => {
  clearManagerSession(res);
  res.status(200).json({ ok: true });
};
