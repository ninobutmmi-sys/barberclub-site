const { Router } = require('express');
const db = require('../config/database');

const router = Router();

/**
 * GET /api/health
 * Health check endpoint for monitoring
 */
router.get('/', async (req, res) => {
  const dbHealth = await db.healthCheck();
  const status = dbHealth.ok ? 200 : 503;

  res.status(status).json({
    status: dbHealth.ok ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    database: dbHealth.ok ? 'connected' : 'disconnected',
    uptime: Math.floor(process.uptime()),
  });
});

module.exports = router;
