const nodemailer = require('nodemailer');
const { env } = require('../config/env');
let transporter = null;
function getTransporter() {
  if (!env.smtpConfigured) return null;
  if (!transporter) transporter = nodemailer.createTransport({ host: env.smtp.host, port: env.smtp.port, secure: env.smtp.port === 465, auth: { user: env.smtp.user, pass: env.smtp.pass } });
  return transporter;
}
async function sendMail({ to, subject, text, html }) {
  const tx = getTransporter();
  if (!tx) {
    console.log(`\n[mail preview] To: ${to}\n[mail preview] Subject: ${subject}\n${text || ''}\n${'-'.repeat(50)}`);
    return { preview: true };
  }
  return tx.sendMail({ from: env.smtp.from, to, subject, text, html });
}
module.exports = { sendMail };
