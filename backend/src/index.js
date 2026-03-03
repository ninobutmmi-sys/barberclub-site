// ============================================
// BarberClub API — Main Server
// ============================================

const config = require('./config/env');
const db = require('./config/database');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const logger = require('./utils/logger');
const { ApiError } = require('./utils/errors');
const { publicLimiter, adminLimiter } = require('./middleware/rateLimiter');
const { requireAuth, requireBarber } = require('./middleware/auth');
const { GRACEFUL_SHUTDOWN_TIMEOUT_MS } = require('./constants');

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
const paymentRoutes = require('./routes/admin/payments');
const mailingRoutes = require('./routes/admin/mailing');
const smsRoutes = require('./routes/admin/sms');
const notificationRoutes = require('./routes/admin/notifications');
const productRoutes = require('./routes/admin/products');
const waitlistRoutes = require('./routes/admin/waitlist');
const automationRoutes = require('./routes/admin/automation');
const { adminRouter: campaignRoutes, publicRouter: campaignTrackRoutes } = require('./routes/admin/campaignTracking');
const systemHealthRoutes = require('./routes/admin/systemHealth');

// Cron job imports
const { queueReminders } = require('./cron/reminders');
const { processQueue, cleanupOldNotifications, cleanupExpiredTokens } = require('./cron/retryNotifications');
const { processAutomationTriggers } = require('./cron/automationTriggers');
const { dailyBackupSnapshot } = require('./cron/backup');

// ============================================
// Cron job tracking (in-memory)
// ============================================
const cronStatus = {
  processQueue:          { label: 'File notifications', schedule: '*/2 * * * *', lastRun: null, status: 'idle', error: null },
  queueReminders:        { label: 'SMS rappels J-1',    schedule: '0 18 * * *',  lastRun: null, status: 'idle', error: null },
  cleanupNotifications:  { label: 'Cleanup notifs 30j', schedule: '0 3 * * *',   lastRun: null, status: 'idle', error: null },
  cleanupExpiredTokens:  { label: 'Cleanup tokens',     schedule: '30 3 * * *',  lastRun: null, status: 'idle', error: null },
  automationTriggers:    { label: 'Triggers auto',      schedule: '*/10 * * * *', lastRun: null, status: 'idle', error: null },
  dailyBackup:           { label: 'Backup snapshot',    schedule: '0 4 * * *',   lastRun: null, status: 'idle', error: null },
};

// Advisory lock IDs — unique per cron to prevent concurrent execution
const CRON_LOCK_IDS = {
  processQueue: 100001,
  queueReminders: 100002,
  cleanupNotifications: 100004,
  cleanupExpiredTokens: 100005,
  automationTriggers: 100006,
  dailyBackup: 100007,
};

function trackCron(key, fn) {
  return async () => {
    const db = require('./config/database');
    const lockId = CRON_LOCK_IDS[key];

    // Try to acquire advisory lock (non-blocking) — skip if another instance is running
    const lockResult = await db.query('SELECT pg_try_advisory_lock($1) AS acquired', [lockId]);
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
    } catch (err) {
      cronStatus[key].status = 'error';
      cronStatus[key].error = err.message;
      cronStatus[key].lastRun = new Date().toISOString();
      logger.error(`Cron ${key} failed`, { error: err.message });
    } finally {
      await db.query('SELECT pg_advisory_unlock($1)', [lockId]);
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
app.use(express.json({ limit: '1mb' }));
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
adminRouter.use('/bookings', adminBookingRoutes);
adminRouter.use('/services', adminServiceRoutes);
adminRouter.use('/barbers', adminBarberRoutes);
adminRouter.use('/clients', adminClientRoutes);
adminRouter.use('/analytics', adminAnalyticsRoutes);
adminRouter.use('/blocked-slots', blockedSlotsRoutes);
adminRouter.use('/payments', paymentRoutes);
adminRouter.use('/mailing', mailingRoutes);
adminRouter.use('/sms', smsRoutes);
adminRouter.use('/notifications', notificationRoutes);
adminRouter.use('/products', productRoutes);
adminRouter.use('/waitlist', waitlistRoutes);
adminRouter.use('/automation', automationRoutes);
adminRouter.use('/campaigns', campaignRoutes);
adminRouter.use('/system', systemHealthRoutes);
app.use('/api/admin', adminRouter);

// Public campaign tracking (no auth)
app.use('/api/track', campaignTrackRoutes);

// ============================================
// Short redirect URLs (for SMS links)
// ============================================
app.get('/r/avis', (req, res) => {
  // Support ?salon=grenoble for per-salon Google Review links
  const salonId = req.query.salon || 'meylan';
  const salon = config.getSalonConfig(salonId);
  res.redirect(302, salon.googleReviewUrl || 'https://barberclub-grenoble.fr');
});

app.get('/r/rdv/:id/:token', async (req, res) => {
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
  // Handle known API errors
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.message,
      details: err.details || undefined,
    });
  }

  // Handle CORS errors
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origine non autorisée' });
  }

  // Handle JSON parse errors
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON invalide' });
  }

  // Unknown errors — log full details but return generic message
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
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
  cron.schedule('*/2 * * * *',  trackCron('processQueue', processQueue));
  cron.schedule('0 18 * * *',   trackCron('queueReminders', queueReminders));
  cron.schedule('0 3 * * *',    trackCron('cleanupNotifications', cleanupOldNotifications));
  cron.schedule('30 3 * * *',   trackCron('cleanupExpiredTokens', cleanupExpiredTokens));
  cron.schedule('*/10 * * * *', trackCron('automationTriggers', processAutomationTriggers));
  cron.schedule('0 4 * * *',    trackCron('dailyBackup', dailyBackupSnapshot));
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
    const server = app.listen(PORT, () => {
      logger.info(`BarberClub API running on port ${PORT}`, {
        env: config.nodeEnv,
        cors: config.corsOrigins,
      });
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
