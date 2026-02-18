// ============================================
// BarberClub API — Main Server
// ============================================

const config = require('./config/env');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cron = require('node-cron');
const logger = require('./utils/logger');
const { ApiError } = require('./utils/errors');
const { publicLimiter, adminLimiter } = require('./middleware/rateLimiter');
const { requireAuth, requireBarber } = require('./middleware/auth');

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

// Cron job imports
const { queueReminders } = require('./cron/reminders');
const { queueReviewRequests } = require('./cron/reviews');
const { processQueue, cleanupOldNotifications, cleanupExpiredTokens } = require('./cron/retryNotifications');

// ============================================
// Express app setup
// ============================================
const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS — only allow configured origins
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

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
app.use('/api', publicLimiter, bookingRoutes);

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
app.use('/api/admin', adminRouter);

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
// ============================================

// Process notification queue every 2 minutes
cron.schedule('*/2 * * * *', processQueue);

// Queue SMS reminders every day at 18:00 (Paris time)
cron.schedule('0 18 * * *', queueReminders);

// Queue review emails every day at 10:00
cron.schedule('0 10 * * *', queueReviewRequests);

// Cleanup old notifications every day at 03:00
cron.schedule('0 3 * * *', cleanupOldNotifications);

// Cleanup expired tokens every day at 03:30
cron.schedule('30 3 * * *', cleanupExpiredTokens);

// ============================================
// Start server
// ============================================
const PORT = config.port;

app.listen(PORT, () => {
  logger.info(`BarberClub API running on port ${PORT}`, {
    env: config.nodeEnv,
    cors: config.corsOrigins,
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: reason?.message || reason });
});

module.exports = app;
