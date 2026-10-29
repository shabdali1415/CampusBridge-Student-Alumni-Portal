const cron = require('node-cron');
const { getPool } = require('../config/db');
const { sendMail } = require('../utils/mailer');
async function sendDueReminders() {
  const pool = getPool();
  const [rows] = await pool.execute(`SELECT r.id, u.email, u.name, e.title, e.starts_at, e.venue
    FROM registrations r JOIN users u ON u.id=r.user_id JOIN events e ON e.id=r.event_id
    WHERE r.status='confirmed' AND r.reminder_sent_at IS NULL
      AND e.starts_at BETWEEN DATE_ADD(NOW(), INTERVAL 23 HOUR) AND DATE_ADD(NOW(), INTERVAL 25 HOUR)
    ORDER BY e.starts_at LIMIT 500`);
  for (const r of rows) {
    try {
      await sendMail({ to:r.email, subject:`Reminder: ${r.title} is tomorrow`, text:`Hi ${r.name},\n\nThis is a reminder that ${r.title} is scheduled for ${new Date(r.starts_at).toLocaleString()}.\nVenue: ${r.venue}\n\nSee you there!` });
      await pool.execute('UPDATE registrations SET reminder_sent_at=NOW() WHERE id=? AND reminder_sent_at IS NULL',[r.id]);
    } catch (e) { console.error('[reminders] Could not send reminder for registration',r.id,e.message); }
  }
  if (rows.length) console.log(`[reminders] Processed ${rows.length} upcoming reminder(s).`);
}
function startReminderScheduler() { cron.schedule('*/15 * * * *', () => sendDueReminders().catch(e=>console.error('[reminders]',e.message))); console.log('[server] Reminder job : every 15 minutes'); }
module.exports = { startReminderScheduler, sendDueReminders };
