const express = require('express');
const { query, param, body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { validate } = require('../middleware/validate');
const { authenticate, authorize, requireVerified } = require('../middleware/auth');
const { getPool } = require('../config/db');

const router = express.Router();
const JOB_TYPES = ['full_time', 'part_time', 'internship', 'contract'];
const SELECT = `SELECT j.id, j.title, j.company, j.location, j.job_type, j.description, j.deadline, j.created_at, u.name AS posted_by
  FROM jobs j JOIN users u ON u.id = j.posted_by`;
const shape = (r) => ({ id: r.id, title: r.title, company: r.company, location: r.location, jobType: r.job_type,
  description: r.description, deadline: r.deadline, postedBy: r.posted_by, createdAt: r.created_at });

router.get('/', validate([
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 50 }).toInt(),
  query('q').optional().trim().isLength({ max: 120 }).escape(),
  query('jobType').optional({ values: 'falsy' }).isIn(JOB_TYPES),
  query('company').optional().trim().isLength({ max: 152 }).escape(),
]), asyncHandler(async (req, res) => {
  const where = ['j.is_active = 1', '(j.deadline IS NULL OR j.deadline >= ?)'], params = [new Date()];
  if (req.query.q) {
    where.push('(j.title LIKE ? OR j.company LIKE ? OR j.location LIKE ? OR j.description LIKE ?)');
    const like = `%${req.query.q}%`; params.push(like, like, like, like);
  }
  if (req.query.jobType) { where.push('j.job_type = ?'); params.push(req.query.jobType); }
  if (req.query.company) { where.push('j.company = ?'); params.push(req.query.company); }
  const limit = req.query.pageSize || 20, offset = ((req.query.page || 1) - 1) * limit;
  // Results are ordered by creation date and paginated.
  const [rows] = await getPool().query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY j.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ success: true, data: { items: rows.map(shape) } });
}));

router.get('/:id', validate([param('id').isInt({ min: 1 }).toInt()]), asyncHandler(async (req, res) => {
  const [rows] = await getPool().execute(`${SELECT} WHERE j.id = ? AND j.is_active = 1`, [req.params.id]);
  if (!rows[0]) throw ApiError.notFound('That job is no longer available.');
  res.json({ success: true, data: shape(rows[0]) });
}));

router.post('/', authenticate, authorize('alumni'), requireVerified, validate([
  body('title').trim().isLength({ min: 3, max: 150 }).withMessage('Title must be 3-150 characters.'),
  body('company').trim().isLength({ min: 2, max: 150 }).withMessage('Company is required.'),
  body('location').trim().isLength({ min: 2, max: 150 }).withMessage('Location is required.'),
  body('jobType').isIn(JOB_TYPES).withMessage('Choose a job type.'),
  body('description').trim().isLength({ min: 10, max: 5000 }).withMessage('Description must be at least 10 characters.'),
  body('deadline').optional({ values: 'falsy' }).isISO8601().withMessage('Deadline is not a valid date.'),
]), asyncHandler(async (req, res) => {
  const [a] = await getPool().execute(`SELECT approved_at FROM alumni_profiles WHERE user_id = ?`, [req.user.id]);
  if (!a[0] || !a[0].approved_at) throw ApiError.forbidden('Your alumni profile must be approved before you can post jobs.', 'ALUMNI_NOT_APPROVED');
  const b = req.body;
  const [r] = await getPool().execute(
    `INSERT INTO jobs (title, company, location, job_type, description, deadline, posted_by, created_at) VALUES (?,?,?,?,?,?,?,?)`,
    [b.title, b.company, b.location, b.jobType, b.description, b.deadline ? new Date(b.deadline) : null, req.user.id, new Date()]);
  res.status(201).json({ success: true, message: 'Job posted.', data: { id: r.insertId } });
}));

router.post('/:id/apply', authenticate, authorize('student'), requireVerified, validate([param('id').isInt({ min: 1 }).toInt()]),
  asyncHandler(async (req, res) => {
    const [j] = await getPool().execute(`SELECT id FROM jobs WHERE id = ? AND is_active = 1 AND (deadline IS NULL OR deadline >= ?)`, [req.params.id, new Date()]);
    if (!j[0]) throw ApiError.notFound('That job is no longer open.');
    const [r] = await getPool().execute(`INSERT IGNORE INTO job_applications (job_id, user_id, created_at) VALUES (?, ?, ?)`, [req.params.id, req.user.id, new Date()]);
    if (!r.affectedRows) throw ApiError.conflict('You have already applied for this job.', 'ALREADY_APPLIED');
    res.status(201).json({ success: true, message: 'Application sent.' });
  }));

module.exports = router;
