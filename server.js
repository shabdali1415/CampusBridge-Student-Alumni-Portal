const { env, validateEnv } = require('./config/env');
const { createApp } = require('./app');
const { testConnection, closePool } = require('./config/db');
const http = require('http');
const { init: initRealtime } = require('./services/realtime');
const { startReminderScheduler } = require('./services/reminders');

async function main() {
  const problems = validateEnv();
  if (problems.length > 0) {
    console.error('[server] Refusing to start - configuration problems:');
    for (const problem of problems) console.error(` - ${problem}`);
    process.exit(1);
  }
  try {
    const status = await testConnection();
    console.log(`[server] Database OK   : MySQL ${status.version} @ ${env.db.host}:${env.db.port}/${env.db.name} (user: ${env.db.user})`);
  } catch (error) {
    console.error(`[server] Cannot reach MySQL: ${error.code || error.message}`);
    console.error('[server] Check DB_* values in .env and run "npm run db:setup".');
    process.exit(1);
  }
  console.log(`[server] Email mode    : ${env.smtpConfigured ? 'SMTP' : 'DEV (SMTP not configured - verification/reset links print to this console)'}`);
  const app = createApp();
  const server = http.createServer(app);
  initRealtime(server);
  startReminderScheduler();
  server.listen(env.port, () => {
    const line = '-'.repeat(55);
    console.log(line);
    console.log(`[server] Campus Portal running at http://localhost:${env.port}`);
    console.log(`[server] Health check  : http://localhost:${env.port}/api/health`);
    console.log(`[server] Environment   : ${env.nodeEnv}`);
    console.log(line);
  });
  const shutdown = (sig) => { console.log(`[server] ${sig} received, shutting down...`); server.close(async () => { await closePool(); process.exit(0); }); };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
main();
