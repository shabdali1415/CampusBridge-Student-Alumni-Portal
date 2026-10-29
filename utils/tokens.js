const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const ApiError = require('./ApiError');

const signAccessToken = (u) => jwt.sign({ sub: u.id, role: u.role }, env.jwt.accessSecret, { expiresIn: env.jwt.accessTtl });
const signRefreshToken = (u) => jwt.sign({ sub: u.id }, env.jwt.refreshSecret, { expiresIn: Math.floor(env.jwt.refreshTtlMs / 1000) });

function verifyAccessToken(token) {
  try { return jwt.verify(token, env.jwt.accessSecret); }
  catch (e) {
    throw ApiError.unauthorized(e.name === 'TokenExpiredError' ? 'Your session has expired.' : 'Invalid session.',
      e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID');
  }
}
function verifyRefreshToken(token) {
  try { return jwt.verify(token, env.jwt.refreshSecret); }
  catch { throw ApiError.unauthorized('Your session has expired. Please sign in again.', 'REFRESH_INVALID'); }
}
const randomToken = () => crypto.randomBytes(32).toString('hex');
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, randomToken, sha256 };
