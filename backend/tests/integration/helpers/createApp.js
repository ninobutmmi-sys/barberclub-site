/**
 * Test app factory — creates a minimal Express app with JSON parsing
 * and error handling, without database connections or cron jobs.
 */
const express = require('express');
const { ApiError } = require('../../../src/utils/errors');

function createTestApp(routeSetup) {
  const app = express();
  app.use(express.json());

  // Attach cronStatus for systemHealth tests
  app.cronStatus = {
    processQueue: { label: 'File notifications', schedule: '*/2 * * * *', lastRun: '2026-03-04T10:00:00Z', status: 'ok', error: null },
    queueReminders: { label: 'SMS rappels J-1', schedule: '0 18 * * *', lastRun: '2026-03-03T18:00:00Z', status: 'ok', error: null },
  };

  routeSetup(app);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Route introuvable', path: req.originalUrl });
  });

  // Global error handler (mirrors real app)
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      return res.status(err.statusCode).json({
        error: err.message,
        details: err.details || undefined,
      });
    }
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  });

  return app;
}

module.exports = { createTestApp };
