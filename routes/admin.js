const express = require('express');
const { query, param, body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { getPool } = require('../config/db');
const { sendMail } = require('../utils/mailer');
const events = require('../services/eventService');

const router = express.Router();
// Every handler below this line requires an active administrator session.
router.use(authenticate, authorize('admin'));


const id = param('id').isInt({ min: 1 }).toInt();
const pool = () => getPool();

/* ---------- QR check-in, attendance, analytics and reminders ---------- */
router.post('/checkin', validate([body('token').trim().isLength({ min: 8, max: 64 }), body('eventId').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt()]), asyncHandler(async (req, res) => {
  const [rows] = await pool().execute(`SELECT r.id,r.status,r.event_id,u.name,u.college_id,e.title FROM registrations r JOIN users u ON u.id=r.user_id JOIN events e ON e.id=r.event_id WHERE r.checkin_token=?`,[req.body.token]);
  const r=rows[0];
  if(!r) throw ApiError.notFound('Ticket not recognised.','TICKET_UNKNOWN');
  if(req.body.eventId && Number(r.event_id)!==Number(req.body.eventId)) throw ApiError.badRequest(`This ticket is for a different event: ${r.title}.`,'WRONG_EVENT');
  if(r.status!=='confirmed') throw ApiError.badRequest('This registration is no longer confirmed.','TICKET_INACTIVE');
  const [u]=await pool().execute('UPDATE registrations SET checked_in_at=? WHERE id=? AND checked_in_at IS NULL',[new Date(),r.id]);
  if(!u.affectedRows) throw ApiError.conflict(`${r.name} was already checked in.`,'ALREADY_CHECKED_IN');
  res.json({success:true,message:`${r.name} checked in.`,data:{name:r.name,collegeId:r.college_id,event:r.title}});
}));
router.get('/events/:id/attendance', validate([id]), asyncHandler(async(req,res)=>{
  const [rows]=await pool().execute(`SELECT u.name,u.college_id,r.status,r.checked_in_at FROM registrations r JOIN users u ON u.id=r.user_id WHERE r.event_id=? AND r.status='confirmed' ORDER BY u.name`,[req.params.id]);
  res.json({success:true,data:rows.map(r=>({name:r.name,collegeId:r.college_id,status:r.status,checkedInAt:r.checked_in_at}))});
}));
router.get('/analytics', asyncHandler(async(_req,res)=>{
  const [[summary]]=await pool().query(`SELECT COUNT(*) total_registrations, SUM(status='confirmed') confirmed, SUM(status='waitlisted') waitlisted, SUM(status='cancelled') cancelled, SUM(checked_in_at IS NOT NULL) checked_in FROM registrations`);
  const [byEvent]=await pool().query(`SELECT e.title, COUNT(r.id) registrations, SUM(r.status='confirmed') confirmed, SUM(r.checked_in_at IS NOT NULL) checkedIn FROM events e LEFT JOIN registrations r ON r.event_id=e.id GROUP BY e.id,e.title ORDER BY registrations DESC,e.starts_at ASC LIMIT 10`);
  const [byMonth]=await pool().query(`SELECT DATE_FORMAT(registered_at,'%Y-%m') month, COUNT(*) registrations FROM registrations WHERE registered_at >= DATE_SUB(CURDATE(),INTERVAL 11 MONTH) GROUP BY DATE_FORMAT(registered_at,'%Y-%m') ORDER BY month`);
  res.json({success:true,data:{summary:Object.fromEntries(Object.entries(summary).map(([k,v])=>[k,Number(v||0)])),byEvent:byEvent.map(r=>({...r,registrations:Number(r.registrations||0),confirmed:Number(r.confirmed||0),checkedIn:Number(r.checkedIn||0)})),byMonth:byMonth.map(r=>({...r,registrations:Number(r.registrations||0)}))}});
}));
router.post('/reminders/run', asyncHandler(async(_req,res)=>{
  const { sendDueReminders }=require('../services/reminders'); await sendDueReminders(); res.json({success:true,message:'Reminder check completed. Check server logs or your configured email inbox.'});
}));


router.get('/stats', asyncHandler(async (_req, res) => {
  const now = new Date();
  const [[u]] = await pool().execute(
    `SELECT COUNT(*) AS total_users, SUM(role = 'student') AS students, SUM(role = 'alumni') AS alumni,
            SUM(role = 'admin') AS admins, SUM(is_active = 0) AS suspended FROM users`);
  const [[e]] = await pool().execute(`SELECT COUNT(*) AS total, SUM(starts_at >= ?) AS upcoming FROM events`, [now]);
  const [[r]] = await pool().execute(`SELECT SUM(status = 'confirmed') AS confirmed, SUM(status = 'waitlisted') AS waitlisted FROM registrations`);
  const [[a]] = await pool().execute(`SELECT SUM(approved_at IS NOT NULL) AS approved, SUM(approved_at IS NULL AND rejected_at IS NULL) AS pending FROM alumni_profiles`);
  const [[j]] = await pool().execute(`SELECT SUM(is_active = 1) AS active, COUNT(*) AS total FROM jobs`);
  const n = (v) => Number(v || 0);
  res.json({ success: true, data: {
    users: { total: n(u.total_users), students: n(u.students), alumni: n(u.alumni), admins: n(u.admins), suspended: n(u.suspended) },
    events: { total: n(e.total), upcoming: n(e.upcoming) },
    registrations: { confirmed: n(r.confirmed), waitlisted: n(r.waitlisted) },
    alumni: { approved: n(a.approved), pending: n(a.pending) },
    jobs: { active: n(j.active), total: n(j.total) },
  } });
}));

/* ---------- events ---------- */
const eventValidators = [
  body('title').trim().isLength({ min: 3, max: 150 }).withMessage('Title must be 3-150 characters.'),
  body('description').trim().isLength({ min: 5, max: 5000 }).withMessage('Add a short description.'),
  body('category').trim().toLowerCase().isLength({ min: 2, max: 60 }).withMessage('Category is required.'),
  body('venue').trim().isLength({ min: 2, max: 150 }).withMessage('Venue is required.'),
  body('startsAt').isISO8601().withMessage('Pick a valid date and time.'),
  body('capacity').isInt({ min: 1, max: 100000 }).withMessage('Capacity must be 1 or more.').toInt(),
];
router.get('/events', asyncHandler(async (_req, res) => {
  const [rows] = await pool().query(`${events.BASE} ORDER BY e.starts_at ASC`);
  res.json({ success: true, data: rows.map(events.shape) });
}));
router.post('/events', validate(eventValidators), asyncHandler(async (req, res) => {
  const b = req.body;
  const [r] = await pool().execute(`INSERT INTO events (title, description, category, venue, starts_at, capacity, created_by) VALUES (?,?,?,?,?,?,?)`,
    [b.title, b.description, b.category, b.venue, new Date(b.startsAt), b.capacity, req.user.id]);
  res.status(201).json({ success: true, message: 'Event created.', data: { id: r.insertId } });
}));
router.put('/events/:id', validate([id, ...eventValidators]), asyncHandler(async (req, res) => {
  const b = req.body;
  let promoted = [];
  await events.withTx(async (conn) => {
    const [evs] = await conn.execute(`SELECT * FROM events WHERE id = ? FOR UPDATE`, [req.params.id]);
    if (!evs[0]) throw ApiError.notFound('That event does not exist.');
    await conn.execute(`UPDATE events SET title=?, description=?, category=?, venue=?, starts_at=?, capacity=? WHERE id=?`,
      [b.title, b.description, b.category, b.venue, new Date(b.startsAt), b.capacity, req.params.id]);
    promoted = await events.promoteWaitlist(conn, { ...evs[0], title: b.title, capacity: b.capacity });
  });
  events.announce(req.params.id, b.title, promoted);
  res.json({ success: true, message: 'Event updated.' });
}));
router.delete('/events/:id', validate([id]), asyncHandler(async (req, res) => {
  const [r] = await pool().execute(`DELETE FROM events WHERE id = ?`, [req.params.id]);
  if (!r.affectedRows) throw ApiError.notFound('That event does not exist.');
  res.json({ success: true, message: 'Event deleted.' });
}));
router.post('/events/:id/notify', validate([id, body('message').trim().isLength({ min: 3, max: 1000 }).withMessage('Write a message to send.')]),
  asyncHandler(async (req, res) => {
    const [ev] = await pool().execute(`SELECT title FROM events WHERE id = ?`, [req.params.id]);
    if (!ev[0]) throw ApiError.notFound('That event does not exist.');
    const [rows] = await pool().execute(`SELECT u.email FROM registrations r JOIN users u ON u.id = r.user_id WHERE r.event_id = ? AND r.status IN ('confirmed','waitlisted')`, [req.params.id]);
    for (const r of rows) await sendMail({ to: r.email, subject: `Update: ${ev[0].title}`, text: req.body.message });
    res.json({ success: true, message: `Notified ${rows.length} registered student(s).` });
  }));

/* ---------- users ---------- */
router.get('/users', validate([
  query('q').optional().trim().isLength({ max: 120 }),
  query('role').optional({ values: 'falsy' }).isIn(['student', 'alumni', 'admin']),
  query('status').optional({ values: 'falsy' }).isIn(['active', 'suspended']),
]), asyncHandler(async (req, res) => {
  const where = ['1=1'], params = [];
  if (req.query.q) { where.push('(name LIKE ? OR email LIKE ? OR college_id LIKE ?)'); const l = `%${req.query.q}%`; params.push(l, l, l); }
  if (req.query.role) { where.push('role = ?'); params.push(req.query.role); }
  if (req.query.status) { where.push('is_active = ?'); params.push(req.query.status === 'active' ? 1 : 0); }
  const [rows] = await pool().query(
    `SELECT id, name, email, role, college_id, email_verified_at, is_active, (SELECT company FROM alumni_profiles WHERE user_id = users.id) AS company
     FROM users WHERE ${where.join(' AND ')} ORDER BY created_at ASC, id ASC LIMIT 500`, params);
  res.json({ success: true, data: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, collegeId: r.college_id,
    company: r.company, verified: !!r.email_verified_at, active: !!r.is_active })) });
}));
router.patch('/users/:id', validate([id, body('role').optional().isIn(['student', 'alumni', 'admin']), body('active').optional().isBoolean().toBoolean()]),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id) throw ApiError.badRequest('You cannot change your own role or status.', 'SELF_CHANGE');
    const sets = [], params = [];
    if (req.body.role !== undefined) { sets.push('role = ?'); params.push(req.body.role); }
    if (req.body.active !== undefined) { sets.push('is_active = ?'); params.push(req.body.active ? 1 : 0); }
    if (!sets.length) throw ApiError.badRequest('Nothing to update.');
    const [r] = await pool().execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, req.params.id]);
    if (!r.affectedRows) throw ApiError.notFound('User not found.');
    if (req.body.role === 'alumni') await pool().execute(`INSERT IGNORE INTO alumni_profiles (user_id) VALUES (?)`, [req.params.id]);
    res.json({ success: true, message: 'User updated.' });
  }));

/* ---------- alumni approvals ---------- */
router.get('/alumni/pending', asyncHandler(async (_req, res) => {
  const [rows] = await pool().execute(
    `SELECT u.id, u.name, u.email, u.email_verified_at, a.graduation_year, a.degree, a.company, a.job_title, a.bio
     FROM alumni_profiles a JOIN users u ON u.id = a.user_id WHERE a.approved_at IS NULL AND a.rejected_at IS NULL ORDER BY u.created_at`);
  res.json({ success: true, data: rows.map((r) => ({ userId: r.id, name: r.name, email: r.email, verified: !!r.email_verified_at,
    graduationYear: r.graduation_year, degree: r.degree, company: r.company, jobTitle: r.job_title, bio: r.bio })) });
}));
router.post('/alumni/:id/:action(approve|reject)', validate([id]), asyncHandler(async (req, res) => {
  const approve = req.params.action === 'approve';
  const [r] = await pool().execute(
    approve ? `UPDATE alumni_profiles SET approved_at = ?, rejected_at = NULL WHERE user_id = ?` : `UPDATE alumni_profiles SET rejected_at = ?, approved_at = NULL WHERE user_id = ?`,
    [new Date(), req.params.id]);
  if (!r.affectedRows) throw ApiError.notFound('Alumni profile not found.');
  res.json({ success: true, message: approve ? 'Alumni profile approved.' : 'Alumni profile rejected.' });
}));

/* ---------- registration report ---------- */
const reportFilters = [query('eventId').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
  query('status').optional({ values: 'falsy' }).isIn(['confirmed', 'waitlisted', 'cancelled'])];
async function reportRows(q) {
  const where = ['1=1'], params = [];
  if (q.eventId) { where.push('r.event_id = ?'); params.push(q.eventId); }
  if (q.status) { where.push('r.status = ?'); params.push(q.status); }
  const [rows] = await pool().query(
    `SELECT u.name, u.email, u.college_id, e.title AS event, e.starts_at, r.status, r.registered_at
     FROM registrations r JOIN users u ON u.id = r.user_id JOIN events e ON e.id = r.event_id
     WHERE ${where.join(' AND ')} ORDER BY r.registered_at DESC, r.id DESC LIMIT 2000`, params);
  return rows;
}
router.get('/registrations', validate(reportFilters), asyncHandler(async (req, res) => {
  const rows = await reportRows(req.query);
  res.json({ success: true, data: rows.map((r) => ({ student: r.name, email: r.email, collegeId: r.college_id, event: r.event,
    eventDate: r.starts_at, status: r.status, registeredAt: r.registered_at })) });
}));
// Prefix formula-looking cells so spreadsheets do not execute them (CSV injection).
const cell = (v) => { let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
router.get('/registrations.csv', validate(reportFilters), asyncHandler(async (req, res) => {
  const rows = await reportRows(req.query);
  const head = ['Student', 'Email', 'College ID', 'Event', 'Event date', 'Status', 'Registered at'];
  const lines = [head.map(cell).join(',')].concat(rows.map((r) => [r.name, r.email, r.college_id, r.event, r.starts_at, r.status, r.registered_at].map(cell).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="registrations.csv"');
  res.send(lines.join('\r\n'));
}));

/* ---------- news ---------- */
router.post('/news', validate([body('title').trim().isLength({ min: 3, max: 200 }).withMessage('Title must be 3-200 characters.'),
  body('body').trim().isLength({ min: 5, max: 5000 }).withMessage('Write the announcement text.')]),
  asyncHandler(async (req, res) => {
    await pool().execute(`INSERT INTO news (title, body, author_id, created_at) VALUES (?,?,?,?)`, [req.body.title, req.body.body, req.user.id, new Date()]);
    res.status(201).json({ success: true, message: 'Announcement published.' });
  }));
router.delete('/news/:id', validate([id]), asyncHandler(async (req, res) => {
  await pool().execute(`DELETE FROM news WHERE id = ?`, [req.params.id]);
  res.json({ success: true, message: 'Announcement deleted.' });
}));

module.exports = router;
