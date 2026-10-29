const mysql = require('mysql2/promise');
const { env } = require('./env');

let pool = null;

// Keep MySQL's NOW() in step with Node's clock/time zone.
function tzOffset() {
  const m = -new Date().getTimezoneOffset();
  const s = m >= 0 ? '+' : '-';
  const a = Math.abs(m);
  return `${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

function createPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host: env.db.host,
    port: env.db.port,
    database: env.db.name,
    user: env.db.user,
    password: env.db.password,
    waitForConnections: true,
    connectionLimit: env.db.connectionLimit,
    queueLimit: 0,
    charset: 'utf8mb4',
    multipleStatements: false, // blocks stacked-query SQL injection
  });
  pool.pool.on('connection', (c) => c.query(`SET time_zone = '${tzOffset()}'`));
  return pool;
}
const getPool = () => pool || createPool();

async function testConnection() {
  const [rows] = await getPool().query('SELECT VERSION() AS version');
  return { version: rows[0].version };
}
async function closePool() {
  if (pool) { await pool.end(); pool = null; }
}
module.exports = { createPool, getPool, testConnection, closePool };
