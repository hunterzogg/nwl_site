const crypto = require('crypto');

const COOKIE_NAME = 'nwl_session';
const ADMIN_COOKIE_NAME = 'nwl_admin';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET env var is not set');
  return s;
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}

function makeToken(payload) {
  const value = `${payload}.${Date.now() + SESSION_TTL_MS}`;
  return `${value}.${sign(value)}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [payload, expiry, sig] = parts;
  const value = `${payload}.${expiry}`;
  const expected = sign(value);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Date.now() > Number(expiry)) return null;
  return payload;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').filter(Boolean).map((c) => {
      const idx = c.indexOf('=');
      return [c.slice(0, idx).trim(), decodeURIComponent(c.slice(idx + 1))];
    })
  );
}

function setCookie(res, name, value, maxAgeSeconds) {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

// Manager session (logged-in manager submitting picks)
function setManagerSession(res, managerName) {
  setCookie(res, COOKIE_NAME, makeToken(managerName), SESSION_TTL_MS / 1000);
}

function getManagerSession(req) {
  const cookies = parseCookies(req);
  return verifyToken(cookies[COOKIE_NAME]);
}

function clearManagerSession(res) {
  clearCookie(res, COOKIE_NAME);
}

// Admin session (Hunter authoring/grading questions) - separate cookie, separate secret check
function setAdminSession(res) {
  setCookie(res, ADMIN_COOKIE_NAME, makeToken('admin'), SESSION_TTL_MS / 1000);
}

function requireAdmin(req) {
  const cookies = parseCookies(req);
  const payload = verifyToken(cookies[ADMIN_COOKIE_NAME]);
  return payload === 'admin';
}

module.exports = {
  setManagerSession,
  getManagerSession,
  clearManagerSession,
  setAdminSession,
  requireAdmin,
};
