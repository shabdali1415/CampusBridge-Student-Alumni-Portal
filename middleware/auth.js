const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyAccessToken } = require('../utils/tokens');
const { getPool } = require('../config/db');

function extractBearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}
async function loadUser(id) {
  const [rows] = await getPool().execute(
    `SELECT id, name, email, role, is_active, email_verified_at FROM users WHERE id = ? LIMIT 1`, [id]);
  return rows && rows[0];
}
const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractBearer(req);
  if (!token) throw ApiError.unauthorized('You must be signed in to do that.', 'TOKEN_MISSING');
  const payload = verifyAccessToken(token);
  const user = await loadUser(payload.sub);
  if (!user) throw ApiError.unauthorized('Your account no longer exists.');
  if (!user.is_active) throw ApiError.forbidden('This account has been suspended.');
  req.user = { id: user.id, role: user.role, name: user.name, email: user.email, verified: !!user.email_verified_at };
  next();
});
const optionalAuthenticate = asyncHandler(async (req, _res, next) => {
  const token = extractBearer(req);
  if (!token) return next();
  try {
    const user = await loadUser(verifyAccessToken(token).sub);
    if (user && user.is_active) req.user = { id: user.id, role: user.role, name: user.name, email: user.email, verified: !!user.email_verified_at };
  } catch { /* treat as anonymous */ }
  next();
});
const authorize = (...roles) => (req, _res, next) =>
  roles.includes(req.user && req.user.role) ? next() : next(ApiError.forbidden());
const requireVerified = (req, _res, next) =>
  req.user && req.user.verified ? next() : next(ApiError.forbidden('Confirm your email address first.', 'EMAIL_NOT_VERIFIED'));

module.exports = { authenticate, optionalAuthenticate, authorize, requireVerified };
