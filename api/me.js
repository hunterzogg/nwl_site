const { getManagerSession } = require('../server_lib/session');

module.exports = async (req, res) => {
  const manager = getManagerSession(req);
  if (!manager) return res.status(401).json({ manager: null });
  res.status(200).json({ manager });
};
