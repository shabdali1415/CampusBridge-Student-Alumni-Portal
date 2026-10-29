const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { env } = require('./config/env');
const { getPool } = require('./config/db');
const { generalLimiter } = require('./middleware/rate-limit');
const { notFound, errorHandler } = require('./middleware/error');
const asyncHandler = require('./utils/asyncHandler');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", "ws:", "wss:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
  }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (origin === env.clientOrigin) return callback(null, origin);
      return callback(null, false);
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', asyncHandler(async (_req, res) => {
    await getPool().query('SELECT 1');
    res.json({ success: true, status: 'ok', time: new Date().toISOString() });
  }));
  app.use('/api', generalLimiter);

  app.get('/api/stats/public', asyncHandler(async (_req, res) => {
    const p = getPool();
    const [[e]] = await p.execute(`SELECT COUNT(*) AS n FROM events WHERE starts_at >= ?`, [new Date()]);
    const [[a]] = await p.execute(`SELECT COUNT(*) AS n FROM alumni_profiles a JOIN users u ON u.id = a.user_id WHERE a.approved_at IS NOT NULL AND u.email_verified_at IS NOT NULL`);
    const [[j]] = await p.execute(`SELECT COUNT(*) AS n FROM jobs WHERE is_active = 1 AND (deadline IS NULL OR deadline >= ?)`, [new Date()]);
    const [[n]] = await p.execute(`SELECT COUNT(*) AS n FROM news`);
    res.json({ success: true, data: { events: e.n, alumni: a.n, jobs: j.n, news: n.n } });
  }));

  // Interactive API docs are served from the checked-in OpenAPI specification.
  app.use('/api-docs', require('swagger-ui-express').serve, require('swagger-ui-express').setup(require('./docs/openapi.json')));

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/events', require('./routes/events'));
  app.use('/api/alumni', require('./routes/alumni'));
  app.use('/api/jobs', require('./routes/jobs'));
  app.use('/api/news', require('./routes/news'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api', notFound);

  app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { index: false, dotfiles: 'deny' }));
  // Prefer the built React app when it exists; retain the original client as a safe fallback.
  const reactDist = path.join(__dirname, 'frontend-react', 'dist');
  if (fs.existsSync(path.join(reactDist, 'index.html'))) {
    app.use(express.static(reactDist, { index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
      res.sendFile(path.join(reactDist, 'index.html'));
    });
  } else {
    app.use(express.static(path.join(__dirname, 'client'), { extensions: ['html'] }));
  }
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
