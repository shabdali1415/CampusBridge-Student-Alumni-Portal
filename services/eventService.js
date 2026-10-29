const { getPool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { sendMail } = require('../utils/mailer');
const realtime = require('./realtime');

const STATUS = { CONFIRMED: 'confirmed', WAITLISTED: 'waitlisted', CANCELLED: 'cancelled' };

const BASE = `SELECT e.id, e.title, e.description, e.category, e.venue, e.starts_at, e.capacity,
  (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'confirmed') AS confirmed,
  (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'waitlisted') AS waitlisted
  FROM events e`;

function shape(r) {
  const confirmed = Number(r.confirmed), capacity = Number(r.capacity);
  return {
    id: r.id, title: r.title, description: r.description, category: r.category, venue: r.venue,
    startsAt: r.starts_at, capacity, confirmed, waitlisted: Number(r.waitlisted),
    seatsRemaining: Math.max(0, capacity - confirmed),
  };
}

async function listEvents({ page = 1, pageSize = 10, category, q, from, to }) {
  const where = [], params = [];
  if (!from && !to) { where.push('e.starts_at >= ?'); params.push(new Date()); }
  if (from) { where.push('e.starts_at >= ?'); params.push(new Date(`${from}T00:00:00`)); }
  if (to) { where.push('e.starts_at <= ?'); params.push(new Date(`${to}T23:59:59`)); }
  if (category) { where.push('e.category = ?'); params.push(category); }
  if (q) { where.push('(e.title LIKE ? OR e.description LIKE ? OR e.venue LIKE ?)'); const l = `%${q}%`; params.push(l, l, l); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pool = getPool();
  const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM events e ${w}`, params);
  const limit = Number(pageSize), offset = (Number(page) - 1) * limit;
  const [rows] = await pool.query(`${BASE} ${w} ORDER BY e.starts_at ASC LIMIT ${limit} OFFSET ${offset}`, params);
  return { items: rows.map(shape), page: Number(page), pageSize: limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

async function waitlistPosition(conn, eventId, userId) {
  const [mine] = await conn.execute(`SELECT id, registered_at FROM registrations WHERE event_id = ? AND user_id = ? AND status = 'waitlisted'`, [eventId, userId]);
  if (!mine[0]) return null;
  const [[{ n }]] = await conn.execute(
    `SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status = 'waitlisted'
     AND (registered_at < ? OR (registered_at = ? AND id <= ?))`,
    [eventId, mine[0].registered_at, mine[0].registered_at, mine[0].id]);
  return n;
}

async function getEvent(id, userId) {
  const pool = getPool();
  const [rows] = await pool.execute(`${BASE} WHERE e.id = ?`, [id]);
  if (!rows[0]) throw ApiError.notFound('That event does not exist.');
  const ev = shape(rows[0]);
  if (userId) {
    const [r] = await pool.execute(`SELECT status FROM registrations WHERE event_id = ? AND user_id = ?`, [id, userId]);
    ev.myRegistration = r[0] ? { status: r[0].status, waitlistPosition: r[0].status === 'waitlisted' ? await waitlistPosition(pool, id, userId) : null } : null;
  }
  return ev;
}

// Move waitlisted people into any free confirmed seats (oldest first).
async function promoteWaitlist(conn, ev) {
  const promoted = [];
  for (;;) {
    const [[{ n }]] = await conn.execute(`SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status = 'confirmed'`, [ev.id]);
    if (n >= ev.capacity) return promoted;
    const [next] = await conn.execute(`SELECT r.id, r.user_id, u.email, u.name FROM registrations r JOIN users u ON u.id = r.user_id
      WHERE r.event_id = ? AND r.status = 'waitlisted' ORDER BY r.registered_at ASC, r.id ASC LIMIT 1 FOR UPDATE`, [ev.id]);
    if (!next[0]) return promoted;
    await conn.execute(`UPDATE registrations SET status = 'confirmed' WHERE id = ?`, [next[0].id]);
    promoted.push(next[0].user_id);
    sendMail({ to: next[0].email, subject: `You're in: ${ev.title}`, text: `Hi ${next[0].name}, a seat opened up and your place at "${ev.title}" is now confirmed.` }).catch(e => console.error('[mail]', e.message));
  }
}
async function broadcastSeats(eventId) {
  try { const ev = await getEvent(eventId); realtime.emitSeats({ id: ev.id, confirmed: ev.confirmed, waitlisted: ev.waitlisted, capacity: ev.capacity, seatsRemaining: ev.seatsRemaining }); } catch (_) {}
}
function announce(eventId, title, promoted = []) {
  broadcastSeats(eventId);
  promoted.forEach((uid) => realtime.notifyUser(uid, { type: 'promoted', eventId, message: `You're in! A seat opened up for "${title}".` }));
}

async function withTx(fn) {
  const conn = await getPool().getConnection();
  try { await conn.beginTransaction(); const out = await fn(conn); await conn.commit(); return out; }
  catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}

async function registerForEvent(eventId, userId) {
  const out = await withTx(async (conn) => {
    const [evs] = await conn.execute(`SELECT * FROM events WHERE id = ? FOR UPDATE`, [eventId]);
    const ev = evs[0];
    if (!ev) throw ApiError.notFound('That event does not exist.');
    if (new Date(ev.starts_at) < new Date()) throw ApiError.badRequest('This event has already started.', 'EVENT_STARTED');
    const [ex] = await conn.execute(`SELECT id, status FROM registrations WHERE event_id = ? AND user_id = ? FOR UPDATE`, [eventId, userId]);
    if (ex[0] && ex[0].status !== STATUS.CANCELLED) throw ApiError.conflict('You are already registered for this event.', 'ALREADY_REGISTERED');
    const [[{ n }]] = await conn.execute(`SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status = 'confirmed'`, [eventId]);
    const status = n < ev.capacity ? STATUS.CONFIRMED : STATUS.WAITLISTED;
    if (ex[0]) await conn.execute(`UPDATE registrations SET status = ?, registered_at = ? WHERE id = ?`, [status, new Date(), ex[0].id]);
    else await conn.execute(`INSERT INTO registrations (event_id, user_id, status, registered_at) VALUES (?, ?, ?, ?)`, [eventId, userId, status, new Date()]);
    return { status, waitlistPosition: await waitlistPosition(conn, eventId, userId), seatsRemaining: Math.max(0, ev.capacity - n - (status === STATUS.CONFIRMED ? 1 : 0)) };
  });
  announce(eventId, '');
  return out;
}

async function cancelRegistration(eventId, userId) {
  const out = await withTx(async (conn) => {
    const [evs] = await conn.execute(`SELECT * FROM events WHERE id = ? FOR UPDATE`, [eventId]);
    if (!evs[0]) throw ApiError.notFound('That event does not exist.');
    const [reg] = await conn.execute(`SELECT id, status FROM registrations WHERE event_id = ? AND user_id = ? FOR UPDATE`, [eventId, userId]);
    if (!reg[0] || reg[0].status === STATUS.CANCELLED) throw ApiError.notFound('You have no active registration for this event.');
    await conn.execute(`UPDATE registrations SET status = 'cancelled' WHERE id = ?`, [reg[0].id]);
    const promoted = reg[0].status === STATUS.CONFIRMED ? await promoteWaitlist(conn, evs[0]) : [];
    return { promoted, title: evs[0].title };
  });
  announce(eventId, out.title, out.promoted);
  return { cancelled: true };
}

async function myRegistrations(userId, filter = 'active') {
  const now = new Date();
  const cond = { active: `AND r.status IN ('confirmed','waitlisted')`, upcoming: `AND r.status IN ('confirmed','waitlisted') AND e.starts_at >= ?`,
    past: `AND e.starts_at < ?`, all: '' }[filter] || '';
  const params = [userId]; if (filter === 'upcoming' || filter === 'past') params.push(now);
  const [rows] = await getPool().execute(
    `SELECT r.status AS reg_status, r.registered_at, e.id, e.title, e.description, e.category, e.venue, e.starts_at, e.capacity,
       (SELECT COUNT(*) FROM registrations x WHERE x.event_id = e.id AND x.status = 'confirmed') AS confirmed,
       (SELECT COUNT(*) FROM registrations x WHERE x.event_id = e.id AND x.status = 'waitlisted') AS waitlisted
     FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.user_id = ? ${cond} ORDER BY e.starts_at ASC`, params);
  const items = [];
  for (const r of rows) {
    items.push({ ...shape(r), status: r.reg_status, registeredAt: r.registered_at,
      waitlistPosition: r.reg_status === 'waitlisted' ? await waitlistPosition(getPool(), r.id, userId) : null });
  }
  return items;
}

async function mySummary(userId) {
  const [[s]] = await getPool().execute(
    `SELECT SUM(r.status = 'confirmed') AS confirmed, SUM(r.status = 'waitlisted') AS waitlisted,
       SUM(r.status IN ('confirmed','waitlisted') AND e.starts_at >= ?) AS upcoming
     FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.user_id = ?`, [new Date(), userId]);
  return { confirmed: Number(s.confirmed || 0), waitlisted: Number(s.waitlisted || 0), upcoming: Number(s.upcoming || 0) };
}

module.exports = { STATUS, listEvents, getEvent, registerForEvent, cancelRegistration, myRegistrations, mySummary, promoteWaitlist, withTx, shape, BASE, announce, broadcastSeats };
