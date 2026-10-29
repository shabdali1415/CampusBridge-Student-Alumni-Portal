/**
 * MySQL integration test for the event-capacity lock and waitlist.
 * Safety: refuses to run unless DB_NAME contains "test". Create the test DB
 * from db/schema.sql first; never point this test at your normal database.
 */
const { getPool, closePool } = require('../config/db');
const eventService = require('../services/eventService');

const enabled = /test/i.test(process.env.DB_NAME || '') && process.env.RUN_DB_INTEGRATION === '1';
const suite = enabled ? describe : describe.skip;

suite('50 simultaneous registrations preserve event capacity', () => {
  let eventId;
  let userIds = [];
  const marker = `loadtest-${Date.now()}-`;
  beforeAll(async () => {
    const pool = getPool();
    const [event] = await pool.execute(
      `INSERT INTO events (title, description, category, venue, starts_at, capacity)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), 10)`,
      [`Concurrency test ${marker}`, 'Temporary integration-test event', 'Testing', 'Test venue']);
    eventId = event.insertId;
    for (let i = 0; i < 50; i++) {
      const [u] = await pool.execute(
        `INSERT INTO users (name, email, password_hash, role, email_verified_at, is_active)
         VALUES (?, ?, ?, 'student', NOW(), 1)`,
        [`Load Test ${i}`, `${marker}${i}@example.test`, '$2a$10$testhashnotused']);
      userIds.push(u.insertId);
    }
  });
  afterAll(async () => {
    const pool = getPool();
    if (eventId) await pool.execute('DELETE FROM registrations WHERE event_id = ?', [eventId]);
    if (eventId) await pool.execute('DELETE FROM events WHERE id = ?', [eventId]);
    if (userIds.length) await pool.query(`DELETE FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`, userIds);
    await closePool();
  });
  test('confirms exactly capacity and waitlists the rest without duplicate registrations', async () => {
    const outcomes = await Promise.all(userIds.map((id) => eventService.registerForEvent(eventId, id)));
    expect(outcomes).toHaveLength(50);
    const pool = getPool();
    const [[counts]] = await pool.execute(
      `SELECT SUM(status='confirmed') confirmed, SUM(status='waitlisted') waitlisted,
              COUNT(*) total FROM registrations WHERE event_id = ?`, [eventId]);
    expect(Number(counts.confirmed)).toBe(10);
    expect(Number(counts.waitlisted)).toBe(40);
    expect(Number(counts.total)).toBe(50);
    expect(outcomes.filter((x) => x.status === 'confirmed')).toHaveLength(10);
    expect(outcomes.filter((x) => x.status === 'waitlisted')).toHaveLength(40);
  }, 60000);
});
