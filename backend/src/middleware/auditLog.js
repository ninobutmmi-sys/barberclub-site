// ============================================
// Audit Log — Fire-and-forget action logger
// ============================================

const db = require('../config/database');
const logger = require('../utils/logger');

/**
 * Log an admin action (fire-and-forget, never throws)
 * @param {object} req - Express request (needs req.user)
 * @param {string} action - e.g. 'create', 'update', 'delete', 'cancel'
 * @param {string} entityType - e.g. 'booking', 'service', 'client'
 * @param {string|null} entityId - UUID of the entity
 * @param {object} details - Extra context (old values, new values, etc.)
 */
function logAudit(req, action, entityType, entityId = null, details = {}) {
  const salonId = req.user?.salon_id || 'meylan';
  const actorId = req.user?.id;
  const actorName = req.user?.first_name
    ? `${req.user.first_name} ${req.user.last_name || ''}`.trim()
    : req.user?.email || 'inconnu';

  if (!actorId) return;

  db.query(
    `INSERT INTO audit_log (salon_id, actor_id, actor_name, action, entity_type, entity_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [salonId, actorId, actorName, action, entityType, entityId, JSON.stringify(details), req.ip]
  ).catch((err) => {
    logger.debug('Audit log insert failed', { error: err.message });
  });
}

module.exports = { logAudit };
