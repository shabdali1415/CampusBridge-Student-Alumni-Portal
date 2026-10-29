const express = require('express');
const bcrypt = require('bcryptjs');
const { body, query } = require('express-validator');
const { getPool } = require('../config/db');
const { env } = require('../config/env');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { checkPassword } = require('../utils/password');
const { signAccessToken, signRefreshToken, verifyRefreshToken, randomToken, sha256 } = require('../utils/tokens');
const { sendMail } = require('../utils/mailer');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { loginLimiter, registerLimiter } = require('../middleware/rate-limit');

const router = express.Router();
const pool = () => getPool();
const COOKIE = 'refresh_token';
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, emailVerified: !!u.email_verified_at });
const setRefresh = (res, user) => res.cookie(COOKIE, signRefreshToken(user), {
  httpOnly: true, sameSite: 'lax', secure: env.isProd, path: '/api/auth', maxAge: env.jwt.refreshTtlMs });

async function issueToken(userId, type, hours) {
  const raw = randomToken();
  await pool().execute(`INSERT INTO email_tokens (user_id, token_hash, type, expires_at) VALUES (?, ?, ?, ?)`,
    [userId, sha256(raw), type, new Date(Date.now() + hours * 3600 * 1000)]);
  return raw;
}
async function sendVerification(user) {
  const t = await issueToken(user.id, 'verify', 24);
  await sendMail({ to: user.email, subject: 'Confirm your Campus Portal email',
    text: `Verify your email: ${env.clientOrigin}/api/auth/verify-email?token=${t}` });
}

const registerValidators = [
  body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Name must be between 2 and 120 characters.'),
  body('email').trim().isEmail().withMessage('Please enter a valid email address.').normalizeEmail({ gmail_remove_dots: false }),
  body('collegeId').optional({ values: 'falsy' }).trim().isLength({ max: 40 }).withMessage('College ID is too long.'),
  body('graduationYear').optional({ values: 'falsy' }).isInt({ min: 1950, max: 2100 }).withMessage('Enter a valid graduation year.').toInt(),
  body('password').isString().withMessage('Password is required.').custom((v) => {
    const r = checkPassword(v); if (!r.valid) throw new Error(r.problems.join(' ')); return true; }),
  body('confirmPassword').isString().custom((v, { req }) => { if (v !== req.body.password) throw new Error('The two passwords do not match.'); return true; }),
  // Public registration deliberately excludes administrator accounts.
  body('role').isIn(['student', 'alumni']).withMessage('Choose student or alumni.'),
];

router.post('/register', registerLimiter, validate(registerValidators), asyncHandler(async (req, res) => {
  const { name, email, password, role, collegeId, graduationYear } = req.body;
  const [dupe] = await pool().execute(`SELECT id FROM users WHERE email = ? LIMIT 1`, [email]);
  if (dupe[0]) throw ApiError.conflict('An account with that email already exists.', 'EMAIL_TAKEN');
  const hash = await bcrypt.hash(password, 12);
  const [r] = await pool().execute(`INSERT INTO users (name, email, password_hash, role, college_id) VALUES (?, ?, ?, ?, ?)`,
    [name, email, hash, role, collegeId || null]);
  if (role === 'alumni') await pool().execute(`INSERT INTO alumni_profiles (user_id, graduation_year) VALUES (?, ?)`, [r.insertId, graduationYear || null]);
  await sendVerification({ id: r.insertId, email });
  res.status(201).json({ success: true, message: 'Account created. Check your inbox for the verification link, then sign in. If SMTP is not configured in development, the link is printed in the server console.' });
}));

const loginValidators = [
  body('email').trim().isEmail().withMessage('Please enter a valid email address.'),
  body('password').isString().notEmpty().withMessage('Password is required.'),
];
router.post('/login', loginLimiter, validate(loginValidators), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await pool().execute(
    `SELECT id, name, email, password_hash, role, is_active, email_verified_at FROM users WHERE email = ? LIMIT 1`, [email]);
  const user = rows[0];
  const passwordOk = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !passwordOk || !user.is_active) {
    throw ApiError.unauthorized('Incorrect email address or password.', 'INVALID_CREDENTIALS');
  }
  setRefresh(res, user);
  res.json({ success: true, data: { accessToken: signAccessToken(user), user: publicUser(user) } });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const raw = req.cookies && req.cookies[COOKIE];
  if (!raw) throw ApiError.unauthorized('No active session.', 'REFRESH_MISSING');
  const payload = verifyRefreshToken(raw);
  const [rows] = await pool().execute(`SELECT id, name, email, role, is_active, email_verified_at FROM users WHERE id = ? LIMIT 1`, [payload.sub]);
  const user = rows[0];
  if (!user || !user.is_active) throw ApiError.unauthorized('No active session.', 'REFRESH_MISSING');
  setRefresh(res, user);
  res.json({ success: true, data: { accessToken: signAccessToken(user), user: publicUser(user) } });
}));

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/api/auth' });
  res.json({ success: true, message: 'Signed out.' });
});

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const [rows] = await pool().execute(`SELECT id, name, email, role, email_verified_at FROM users WHERE id = ?`, [req.user.id]);
  res.json({ success: true, data: { user: publicUser(rows[0]) } });
}));

router.get('/verify-email', validate([query('token').isString().isLength({ min: 20, max: 128 })]), asyncHandler(async (req, res) => {
  const [rows] = await pool().execute(
    `SELECT id, user_id FROM email_tokens WHERE token_hash = ? AND type = 'verify' AND used_at IS NULL AND expires_at > ? LIMIT 1`,
    [sha256(req.query.token), new Date()]);
  if (!rows[0]) return res.redirect('/login.html?verified=invalid');
  await pool().execute(`UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL`, [new Date(), rows[0].user_id]);
  await pool().execute(`UPDATE email_tokens SET used_at = ? WHERE id = ?`, [new Date(), rows[0].id]);
  res.redirect('/login.html?verified=1');
}));

router.post('/resend-verification', authenticate, asyncHandler(async (req, res) => {
  if (req.user.verified) return res.json({ success: true, message: 'Your email is already confirmed.' });
  await sendVerification(req.user);
  res.json({ success: true, message: 'Verification link sent.' });
}));

router.post('/forgot-password', loginLimiter, validate([body('email').trim().isEmail().withMessage('Please enter a valid email address.')]),
  asyncHandler(async (req, res) => {
    const [rows] = await pool().execute(`SELECT id, email FROM users WHERE email = ? AND is_active = 1 LIMIT 1`, [req.body.email]);
    if (rows[0]) {
      const t = await issueToken(rows[0].id, 'reset', 1);
      await sendMail({ to: rows[0].email, subject: 'Reset your Campus Portal password', text: `Reset link (valid 1 hour): ${env.clientOrigin}/reset-password.html?token=${t}` });
    }
    res.json({ success: true, message: 'If that email is registered, a reset link is on its way.' });
  }));

router.post('/reset-password', validate([
  body('token').isString().isLength({ min: 20, max: 128 }).withMessage('This reset link is not valid.'),
  body('password').isString().custom((v) => { const r = checkPassword(v); if (!r.valid) throw new Error(r.problems.join(' ')); return true; }),
]), asyncHandler(async (req, res) => {
  const [rows] = await pool().execute(
    `SELECT id, user_id FROM email_tokens WHERE token_hash = ? AND type = 'reset' AND used_at IS NULL AND expires_at > ? LIMIT 1`,
    [sha256(req.body.token), new Date()]);
  if (!rows[0]) throw ApiError.badRequest('This reset link has expired or was already used.', 'TOKEN_INVALID_RESET');
  await pool().execute(`UPDATE users SET password_hash = ? WHERE id = ?`, [await bcrypt.hash(req.body.password, 12), rows[0].user_id]);
  await pool().execute(`UPDATE email_tokens SET used_at = ? WHERE id = ?`, [new Date(), rows[0].id]);
  res.json({ success: true, message: 'Password updated. You can sign in now.' });
}));

module.exports = router;
