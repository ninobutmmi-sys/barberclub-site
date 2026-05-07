// ============================================
// BarberClub API — Main Server
// ============================================

const http = require('http');
const config = require('./config/env');
const db = require('./config/database');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const logger = require('./utils/logger');
const { ApiError } = require('./utils/errors');
const { trackError } = require('./utils/errorTracker');
const { publicLimiter, adminLimiter } = require('./middleware/rateLimiter');
const { requireAuth, requireBarber } = require('./middleware/auth');
const { GRACEFUL_SHUTDOWN_TIMEOUT_MS } = require('./constants');
const { alertCronFailure } = require('./utils/discord');
const { getParisTodayISO } = require('./utils/date');

// Route imports
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const bookingRoutes = require('./routes/bookings');
const clientRoutes = require('./routes/client');
const adminBookingRoutes = require('./routes/admin/bookings');
const adminServiceRoutes = require('./routes/admin/services');
const adminBarberRoutes = require('./routes/admin/barbers');
const adminClientRoutes = require('./routes/admin/clients');
const adminAnalyticsRoutes = require('./routes/admin/analytics');
const blockedSlotsRoutes = require('./routes/admin/blockedSlots');
const mailingRoutes = require('./routes/admin/mailing');
const smsRoutes = require('./routes/admin/sms');
const notificationRoutes = require('./routes/admin/notifications');
const waitlistRoutes = require('./routes/admin/waitlist');
const automationRoutes = require('./routes/admin/automation');
const { adminRouter: campaignRoutes, publicRouter: campaignTrackRoutes } = require('./routes/admin/campaignTracking');
const systemHealthRoutes = require('./routes/admin/systemHealth');
const auditLogRoutes = require('./routes/admin/auditLog');
const pushRoutes = require('./routes/admin/push');
const productRoutes = require('./routes/admin/products');
const objectivesRoutes = require('./routes/admin/objectives');
const tasksRoutes = require('./routes/admin/tasks');
const { publicRouter: eventAlertPublicRoutes, adminRouter: eventAlertAdminRoutes } = require('./routes/eventAlerts');
const brevoSmsWebhookRoutes = require('./routes/webhooks/brevoSms');
const twilioWebhookRoutes = require('./routes/webhooks/twilio');

// Cron job imports
const { queueReminders } = require('./cron/reminders');
const { processQueue, cleanupOldNotifications, cleanupExpiredTokens, cleanupOldOverrides } = require('./cron/retryNotifications');
const { processAutomationTriggers } = require('./cron/automationTriggers');
const { dailyBackupSnapshot } = require('./cron/backup');
const { reconcileSmsDelivery } = require('./cron/reconcileSmsDelivery');

// ============================================
// Cron job tracking (in-memory)
// ============================================
const cronStatus = {
  processQueue:          { label: 'File notifications', schedule: '*/2 * * * *', lastRun: null, status: 'idle', error: null },
  queueReminders:        { label: 'SMS rappels 24h',    schedule: '*/30 * * * *', lastRun: null, status: 'idle', error: null },
  cleanupNotifications:  { label: 'Cleanup notifs 30j', schedule: '0 3 * * *',   lastRun: null, status: 'idle', error: null },
  cleanupExpiredTokens:  { label: 'Cleanup tokens',     schedule: '30 3 * * *',  lastRun: null, status: 'idle', error: null },
  cleanupOldOverrides:   { label: 'Cleanup overrides',  schedule: '45 3 * * *',  lastRun: null, status: 'idle', error: null },
  automationTriggers:    { label: 'Triggers auto',      schedule: '*/10 * * * *', lastRun: null, status: 'idle', error: null },
  dailyBackup:           { label: 'Backup snapshot',    schedule: '0 4 * * *',   lastRun: null, status: 'idle', error: null },
  reconcileSmsDelivery:  { label: 'Reconcile SMS Brevo', schedule: '*/30 * * * *', lastRun: null, status: 'idle', error: null },
};

// Advisory lock IDs — unique per cron to prevent concurrent execution
const CRON_LOCK_IDS = {
  processQueue: 100001,
  queueReminders: 100002,
  cleanupNotifications: 100004,
  cleanupExpiredTokens: 100005,
  cleanupOldOverrides: 100009,
  automationTriggers: 100006,
  dailyBackup: 100007,
  reconcileSmsDelivery: 100008,
};

// Track consecutive failures per cron job for alerting
const cronFailureCounts = {};
const CRON_ALERT_THRESHOLD = 3;
let cronAlertCooldown = {}; // prevent alert spam (1 alert per hour per cron)

function trackCron(key, fn) {
  cronFailureCounts[key] = 0;
  return async () => {
    const { getClient } = require('./config/database');
    const lockId = CRON_LOCK_IDS[key];

    // Use a dedicated connection for advisory lock (lock + unlock on same connection)
    const client = await getClient();
    try {
      const lockResult = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [lockId]);
      if (!lockResult.rows[0].acquired) {
        logger.debug(`Cron ${key} skipped — already running on another instance`);
        return;
      }

      cronStatus[key].status = 'running';
      cronStatus[key].error = null;
      try {
        await fn();
        cronStatus[key].status = 'ok';
        cronStatus[key].lastRun = new Date().toISOString();
        cronFailureCounts[key] = 0; // reset on success
      } catch (err) {
        cronStatus[key].status = 'error';
        cronStatus[key].error = err.message;
        cronStatus[key].lastRun = new Date().toISOString();
        cronFailureCounts[key]++;
        logger.error(`Cron ${key} failed (${cronFailureCounts[key]}x consecutive)`, { error: err.message });

        // Alert after N consecutive failures (max 1 alert per hour per cron)
        if (cronFailureCounts[key] >= CRON_ALERT_THRESHOLD) {
          const now = Date.now();
          const lastAlert = cronAlertCooldown[key] || 0;
          if (now - lastAlert > 60 * 60 * 1000) {
            cronAlertCooldown[key] = now;
            const label = cronStatus[key].label || key;
            const msg = `⚠️ ALERTE CRON — "${label}" a échoué ${cronFailureCounts[key]} fois d'affilée. Dernière erreur: ${err.message}`;
            logger.error(`CRON ALERT: ${msg}`);
            // Discord alert (fire-and-forget)
            alertCronFailure(label, cronFailureCounts[key], err.message);
            // Send SMS alert to owner (best-effort, don't crash if it fails)
            try {
              const { sendSMS } = require('./services/notification');
              const ownerPhone = config.salon.phone;
              if (ownerPhone) {
                await sendSMS(ownerPhone, msg, 'meylan');
              }
            } catch (alertErr) {
              logger.error('Failed to send cron alert SMS', { error: alertErr.message });
            }
          }
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
      }
    } finally {
      client.release();
    }
  };
}

// ============================================
// Express app setup
// ============================================
const app = express();
app.cronStatus = cronStatus;

// Trust Railway's reverse proxy (fixes rate limiter IP detection + req.protocol)
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS — only allow configured origins
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no Origin header (direct browser navigation, e.g. .ics download)
    // Security is handled per-route via tokens, JWT auth, and rate limiting
    if (!origin) {
      return callback(null, true);
    }

    if (config.corsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS blocked request from origin', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Cookie parsing (for httpOnly refresh token cookie)
app.use(cookieParser());

// Body parsing
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));

// Request logging (non-sensitive)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](`${req.method} ${req.originalUrl}`, {
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
    });
  });
  next();
});

// ============================================
// Routes
// ============================================

// Public routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', bookingRoutes); // publicLimiter already applied per-route in bookingRoutes

// Client routes (authenticated)
app.use('/api/client', clientRoutes);

// Admin/barber routes (authenticated)
const adminRouter = express.Router();
adminRouter.use(requireAuth, requireBarber, adminLimiter);
// Override salon_id from JWT with the one sent by the dashboard (query/body)
// Verify the barber belongs to the requested salon or is a guest there today
adminRouter.use(async (req, res, next) => {
  const fromRequest = req.query.salon_id || req.body?.salon_id;
  if (fromRequest && ['meylan', 'grenoble'].includes(fromRequest)) {
    if (fromRequest !== req.user.salon_id) {
      // Check if barber is a guest in the requested salon today
      try {
        const today = getParisTodayISO();
        const guestCheck = await db.query(
          'SELECT 1 FROM guest_assignments WHERE barber_id = $1 AND host_salon_id = $2 AND date = $3',
          [req.user.id, fromRequest, today]
        );
        if (guestCheck.rows.length === 0) {
          return res.status(403).json({ error: 'Accès non autorisé à ce salon' });
        }
      } catch (err) {
        logger.error('Guest assignment check failed', { error: err.message });
        return res.status(500).json({ error: 'Erreur serveur' });
      }
    }
    req.user.salon_id = fromRequest;
  }
  next();
});
adminRouter.use('/bookings', adminBookingRoutes);
adminRouter.use('/services', adminServiceRoutes);
adminRouter.use('/barbers', adminBarberRoutes);
adminRouter.use('/clients', adminClientRoutes);
adminRouter.use('/analytics', adminAnalyticsRoutes);
adminRouter.use('/blocked-slots', blockedSlotsRoutes);
adminRouter.use('/mailing', mailingRoutes);
adminRouter.use('/sms', smsRoutes);
adminRouter.use('/notifications', notificationRoutes);
adminRouter.use('/waitlist', waitlistRoutes);
adminRouter.use('/automation', automationRoutes);
adminRouter.use('/campaigns', campaignRoutes);
adminRouter.use('/system', systemHealthRoutes);
adminRouter.use('/audit-log', auditLogRoutes);
adminRouter.use('/push', pushRoutes);
adminRouter.use('/products', productRoutes);
adminRouter.use('/objectives', objectivesRoutes);
adminRouter.use('/tasks', tasksRoutes);
adminRouter.use('/event-alerts', eventAlertAdminRoutes);
app.use('/api/admin', adminRouter);

// Public event alerts (subscribe)
app.use('/api/event-alerts', eventAlertPublicRoutes);

// Public campaign tracking (no auth)
app.use('/api/track', campaignTrackRoutes);

// SMS delivery webhooks (no auth — token in URL)
app.use('/api/webhooks', brevoSmsWebhookRoutes);
app.use('/api/webhooks', twilioWebhookRoutes);

// ============================================
// Short redirect URLs (for SMS links)
// ============================================
app.get('/r/avis', publicLimiter, (req, res) => {
  // Support ?salon=grenoble for per-salon Google Review links
  const salonId = req.query.salon || 'meylan';
  const salon = config.getSalonConfig(salonId);
  res.redirect(302, salon.googleReviewUrl || 'https://barberclub-grenoble.fr');
});

app.get('/r/rdv/:id/:token', publicLimiter, async (req, res) => {
  // Fetch booking to determine which salon page to redirect to
  try {
    const result = await db.query(
      'SELECT salon_id FROM bookings WHERE id = $1 AND cancel_token = $2 AND deleted_at IS NULL',
      [req.params.id, req.params.token]
    );
    const salonId = result.rows.length > 0 ? (result.rows[0].salon_id || 'meylan') : 'meylan';
    const salon = config.getSalonConfig(salonId);
    res.redirect(302, `${config.siteUrl}${salon.bookingPath}/mon-rdv.html?id=${req.params.id}&token=${req.params.token}`);
  } catch {
    // Fallback to meylan on error
    res.redirect(302, `${config.siteUrl}/pages/meylan/mon-rdv.html?id=${req.params.id}&token=${req.params.token}`);
  }
});

// ============================================
// 404 handler
// ============================================
app.use((req, res) => {
  res.status(404).json({
    error: 'Route introuvable',
    path: req.originalUrl,
  });
});

// ============================================
// Global error handler
// ============================================
app.use((err, req, res, next) => {
  const isDev = config.nodeEnv !== 'production';

  // Handle known API errors
  if (err instanceof ApiError) {
    // Track 4xx/5xx API errors (skip 401s to avoid noise from expired tokens)
    if (err.statusCode >= 400 && err.statusCode !== 401) {
      trackError({
        method: req.method,
        path: req.originalUrl,
        status: err.statusCode,
        message: err.message,
        type: 'ApiError',
        user: req.user || null,
      });
    }
    return res.status(err.statusCode).json({
      error: err.message,
      details: err.details || undefined,
    });
  }

  // Handle CORS errors
  if (err.message === 'Not allowed by CORS') {
    trackError({
      method: req.method,
      path: req.originalUrl,
      status: 403,
      message: 'Not allowed by CORS',
      type: 'CORSError',
    });
    return res.status(403).json({ error: 'Origine non autorisée' });
  }

  // Handle JSON parse errors
  if (err.type === 'entity.parse.failed') {
    trackError({
      method: req.method,
      path: req.originalUrl,
      status: 400,
      message: 'JSON invalide',
      type: 'ParseError',
    });
    return res.status(400).json({ error: 'JSON invalide' });
  }

  // Unknown errors — log full details but return generic message
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
  });

  trackError({
    method: req.method,
    path: req.originalUrl,
    status: 500,
    message: err.message,
    stack: isDev ? err.stack : undefined,
    type: err.name || 'UnhandledError',
    user: req.user || null,
  });

  res.status(500).json({
    error: 'Erreur serveur, réessayez dans quelques instants',
  });
});

// ============================================
// Cron jobs (scheduled tasks)
// Only run in production to avoid duplicates when dev + prod share the same DB
// ============================================

if (config.nodeEnv === 'production') {
  cron.schedule('*/1 * * * *',  trackCron('processQueue', processQueue));
  cron.schedule('*/30 * * * *', trackCron('queueReminders', queueReminders));
  cron.schedule('0 3 * * *',    trackCron('cleanupNotifications', cleanupOldNotifications));
  cron.schedule('30 3 * * *',   trackCron('cleanupExpiredTokens', cleanupExpiredTokens));
  cron.schedule('45 3 * * *',   trackCron('cleanupOldOverrides', cleanupOldOverrides));
  cron.schedule('*/10 * * * *', trackCron('automationTriggers', processAutomationTriggers));
  cron.schedule('0 4 * * *',    trackCron('dailyBackup', dailyBackupSnapshot));
  cron.schedule('*/30 * * * *', trackCron('reconcileSmsDelivery', reconcileSmsDelivery));
  logger.info('Cron jobs enabled (production)');
} else {
  logger.info('Cron jobs disabled (development) — only production sends SMS/emails via crons');
}

// ============================================
// Start server (skip in test mode — supertest manages its own)
// ============================================
const { pool, ensureConnection } = require('./config/database');

if (config.nodeEnv !== 'test') {
  const PORT = config.port;

  // Verify DB is reachable before accepting traffic
  ensureConnection().then(() => {
    const server = http.createServer(app);

    // Initialize WebSocket
    const ws = require('./services/websocket');
    ws.init(server);

    server.listen(PORT, async () => {
      logger.info(`BarberClub API running on port ${PORT}`, {
        env: config.nodeEnv,
        cors: config.corsOrigins,
      });
      // Run pending migrations on startup (with tracking)
      try {
        const fs = require('fs');
        const path = require('path');
        const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
        if (fs.existsSync(migrationsDir)) {
          // Create tracking table if needed
          await db.query(`
            CREATE TABLE IF NOT EXISTS _migrations (
              id SERIAL PRIMARY KEY,
              filename VARCHAR(255) NOT NULL UNIQUE,
              applied_at TIMESTAMPTZ DEFAULT NOW()
            )
          `);

          const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

          // First run with new system: mark all existing migrations as already applied
          const { rows: existing } = await db.query('SELECT COUNT(*) FROM _migrations');
          if (parseInt(existing[0].count) === 0 && files.length > 0) {
            const values = files.map((f, i) => `($${i + 1})`).join(', ');
            await db.query(
              `INSERT INTO _migrations (filename) VALUES ${values} ON CONFLICT DO NOTHING`,
              files
            );
            logger.info(`Migrations: marked ${files.length} existing migrations as applied (first run with tracking)`);
          } else {
            // Normal run: only execute new migrations
            const { rows: applied } = await db.query('SELECT filename FROM _migrations');
            const appliedSet = new Set(applied.map(r => r.filename));
            const pending = files.filter(f => !appliedSet.has(f));

            for (const file of pending) {
              const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
              await db.query(sql);
              await db.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
              logger.info(`Migration applied: ${file}`);
            }

            logger.info(`Migrations checked (${files.length} files, ${pending.length} new applied)`);
          }
        }
      } catch (err) {
        logger.error('Migration check failed', { error: err.message });
      }
      // Check Brevo API keys on startup
      try {
        const { checkSmsProviderKeys } = require('./services/notification');
        await checkSmsProviderKeys();
      } catch (err) {
        logger.error('Brevo key check failed on startup', { error: err.message });
      }
    });

    // Graceful shutdown — finish in-flight requests + close DB pool
    const gracefulShutdown = (signal) => {
      logger.info(`${signal} received, shutting down gracefully`);
      server.close(() => {
        pool.end().then(() => process.exit(0));
      });
      setTimeout(() => process.exit(1), GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    };
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: reason?.message || reason });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — process will exit', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

module.exports = app;
