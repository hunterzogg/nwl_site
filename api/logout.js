const { clearManagerSession } = require('../server_lib/session');

module.exports = async (req, res) => {
  clearManagerSession(res);
  res.status(200).json({ ok: true });
};
