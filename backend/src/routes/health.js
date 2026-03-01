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

/**
 * GET /api/ping
 * Ultra-light endpoint for external monitors (UptimeRobot, etc.)
 * No DB, no auth, no logging overhead — just proves the process is alive.
 */
router.get('/ping', (req, res) => {
  res.send('pong');
});

module.exports = router;
