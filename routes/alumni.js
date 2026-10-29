const express = require('express');
const { query, param } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { validate } = require('../middleware/validate');
const { authenticate, optionalAuthenticate, requireVerified } = require('../middleware/auth');
const { getPool } = require('../config/db');

const router = express.Router();
const APPROVED_PREDICATE = 'a.approved_at IS NOT NULL AND u.email_verified_at IS NOT NULL AND u.is_active = 1';

const mask = (email) => { const [l, d] = email.split('@'); return `${l[0]}${'*'.repeat(Math.max(3, l.length - 1))}@${d}`; };

router.get('/directory', optionalAuthenticate, validate([
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 50 }).toInt(),
  query('q').optional().trim().isLength({ max: 120 }).escape(),
  query('graduationYear').optional({ values: 'falsy' }).isInt({ min: 1950, max: 2100 }).toInt(),
  query('degree').optional().trim().isLength({ max: 120 }).escape(),
  query('company').optional().trim().isLength({ max: 152 }).escape(),
]), asyncHandler(async (req, res) => {
  // Query only profiles that are verified and approved.
  const where = [APPROVED_PREDICATE], params = [];
  const { q, graduationYear, degree, company } = req.query;
  if (q) { where.push('(u.name LIKE ? OR a.company LIKE ? OR a.degree LIKE ? OR a.job_title LIKE ?)'); const l = `%${q}%`; params.push(l, l, l, l); }
  if (graduationYear) { where.push('a.graduation_year = ?'); params.push(graduationYear); }
  if (degree) { where.push('a.degree = ?'); params.push(degree); }
  if (company) { where.push('a.company = ?'); params.push(company); }
  const limit = req.query.pageSize || 12, offset = ((req.query.page || 1) - 1) * limit;
  const [rows] = await getPool().query(
    `SELECT u.id, u.name, u.email, u.avatar, a.job_title, a.company, a.degree, a.graduation_year, a.bio
     FROM alumni_profiles a JOIN users u ON u.id = a.user_id WHERE ${where.join(' AND ')} ORDER BY u.name LIMIT ${limit} OFFSET ${offset}`, params);
  let mine = new Set();
  if (req.user) {
    const [c] = await getPool().execute(`SELECT to_user FROM connections WHERE from_user = ?`, [req.user.id]);
    mine = new Set(c.map((x) => x.to_user));
  }
  res.json({ success: true, data: { items: rows.map((r) => ({
    userId: r.id, name: r.name, avatar: r.avatar, jobTitle: r.job_title, company: r.company, degree: r.degree,
    graduationYear: r.graduation_year, bio: r.bio, emailMasked: mask(r.email), connected: mine.has(r.id) })) } });
}));

router.get('/directory/filters', asyncHandler(async (_req, res) => {
  const base = `FROM alumni_profiles a JOIN users u ON u.id = a.user_id WHERE ${APPROVED_PREDICATE}`;
  const col = async (c, order) => (await getPool().query(`SELECT DISTINCT a.${c} AS v ${base} AND a.${c} IS NOT NULL ORDER BY a.${c} ${order}`))[0].map((r) => r.v);
  res.json({ success: true, data: { years: await col('graduation_year', 'DESC'), degrees: await col('degree', 'ASC'), companies: await col('company', 'ASC') } });
}));

router.post('/connect/:userId', authenticate, requireVerified, validate([param('userId').isInt({ min: 1 }).toInt()]),
  asyncHandler(async (req, res) => {
    if (req.params.userId === req.user.id) throw ApiError.badRequest('You cannot connect with yourself.');
    const [t] = await getPool().execute(`SELECT a.user_id FROM alumni_profiles a JOIN users u ON u.id = a.user_id WHERE a.user_id = ? AND ${APPROVED_PREDICATE}`, [req.params.userId]);
    if (!t[0]) throw ApiError.notFound('That alumni profile is not available.');
    await getPool().execute(`INSERT IGNORE INTO connections (from_user, to_user, created_at) VALUES (?, ?, ?)`, [req.user.id, req.params.userId, new Date()]);
    res.status(201).json({ success: true, message: 'Connection request sent.' });
  }));

module.exports = router;
