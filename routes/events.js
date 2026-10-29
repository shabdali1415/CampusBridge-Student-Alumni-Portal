const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const ApiError = require('../utils/ApiError');
const { query, param } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const { authenticate, optionalAuthenticate, authorize } = require('../middleware/auth');
const eventService = require('../services/eventService');
const { getPool } = require('../config/db');

const router = express.Router();
const parseId = param('id').isInt({ min: 1 }).withMessage('Invalid event id.').toInt();

router.get('/', validate([
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 50 }).toInt(),
  query('category').optional().trim().isLength({ max: 60 }).escape(),
  query('q').optional().trim().isLength({ max: 120 }).escape(),
  query('from').optional({ values: 'falsy' }).isISO8601().withMessage('From date is not valid.'),
  query('to').optional({ values: 'falsy' }).isISO8601().withMessage('To date is not valid.'),
]), asyncHandler(async (req, res) => {
  const result = await eventService.listEvents({
    page: req.query.page, pageSize: req.query.pageSize || 10,
    category: req.query.category || undefined, q: req.query.q || undefined,
    from: req.query.from || undefined, to: req.query.to || undefined,
  });
  res.json({ success: true, data: result });
}));

router.get('/categories', asyncHandler(async (_req, res) => {
  const [rows] = await getPool().execute(`SELECT DISTINCT category FROM events ORDER BY category`);
  res.json({ success: true, data: rows.map((r) => r.category) });
}));

router.get('/me/summary', authenticate, authorize('student'), asyncHandler(async (req, res) =>
  res.json({ success: true, data: await eventService.mySummary(req.user.id) })));

router.get('/me/registrations', authenticate, authorize('student'),
  validate([query('filter').optional().isIn(['active', 'upcoming', 'past', 'all'])]),
  asyncHandler(async (req, res) =>
    res.json({ success: true, data: await eventService.myRegistrations(req.user.id, req.query.filter || 'active') })));

router.get('/:id/ticket', authenticate, authorize('student'), validate([parseId]), asyncHandler(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.execute(`SELECT r.id, r.status, r.checkin_token, r.checked_in_at, e.title, e.starts_at, e.venue
    FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.event_id=? AND r.user_id=?`, [req.params.id, req.user.id]);
  const r = rows[0];
  if (!r || r.status !== 'confirmed') throw ApiError.notFound('You need a confirmed registration to get a ticket.', 'NO_TICKET');
  let ticket = r.checkin_token;
  if (!ticket) { ticket = crypto.randomBytes(16).toString('hex'); await pool.execute('UPDATE registrations SET checkin_token=? WHERE id=? AND checkin_token IS NULL',[ticket,r.id]); const [[fresh]] = await pool.execute('SELECT checkin_token FROM registrations WHERE id=?',[r.id]); ticket=fresh.checkin_token; }
  const qr = await QRCode.toDataURL(ticket, { width: 260, margin: 1 });
  res.json({ success:true, data:{ title:r.title, startsAt:r.starts_at, venue:r.venue, qr, code:ticket, checkedInAt:r.checked_in_at } });
}));

router.get('/:id', optionalAuthenticate, validate([parseId]), asyncHandler(async (req, res) =>
  res.json({ success: true, data: await eventService.getEvent(req.params.id, req.user && req.user.id) })));

router.post('/:id/register', authenticate, authorize('student'), validate([parseId]),
  asyncHandler(async (req, res) => {
    const outcome = await eventService.registerForEvent(req.params.id, req.user.id);
    res.status(201).json({
      success: true,
      message: outcome.status === eventService.STATUS.CONFIRMED
        ? 'Your place is confirmed.' : `Added to waitlist at position ${outcome.waitlistPosition}.`,
      data: outcome,
    });
  }));

router.delete('/:id/register', authenticate, authorize('student'), validate([parseId]),
  asyncHandler(async (req, res) => {
    await eventService.cancelRegistration(req.params.id, req.user.id);
    res.json({ success: true, message: 'Your registration has been cancelled.' });
  }));

module.exports = router;
