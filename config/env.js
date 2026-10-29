require('dotenv').config();
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const port = num(process.env.PORT, 5000);

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port,
  clientOrigin: process.env.CLIENT_ORIGIN || `http://localhost:${port}`,
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    name: process.env.DB_NAME || 'student_portal',
    user: process.env.DB_USER || 'student_portal_app',
    password: process.env.DB_PASSWORD || '',
    connectionLimit: num(process.env.DB_CONNECTION_LIMIT, 10),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || '',
    refreshSecret: process.env.JWT_REFRESH_SECRET || '',
    accessTtl: '15m',
    refreshTtlMs: 7 * 24 * 60 * 60 * 1000,
  },
  rateLimit: {
    windowMs: 60 * 1000,
    max: num(process.env.RATE_LIMIT_MAX, 300),
    loginWindowMs: 15 * 60 * 1000,
    loginMax: num(process.env.LOGIN_RATE_LIMIT_MAX, 10),
  },
  smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
  smtp: { host: process.env.SMTP_HOST || '', port: num(process.env.SMTP_PORT, 587), user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '', from: process.env.MAIL_FROM || 'Campus Portal <no-reply@campus.local>' },
};
env.isProd = env.nodeEnv === 'production';

function validateEnv() {
  const problems = [];
  if (env.jwt.accessSecret.length < 16) problems.push('JWT_ACCESS_SECRET must be at least 16 characters.');
  if (env.jwt.refreshSecret.length < 16) problems.push('JWT_REFRESH_SECRET must be at least 16 characters.');
  if (!env.db.password) problems.push('DB_PASSWORD is not set.');
  return problems;
}
module.exports = { env, validateEnv };
