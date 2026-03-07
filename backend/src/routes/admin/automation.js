const { Router } = require('express');
const { body, param } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const { ApiError } = require('../../utils/errors');
const db = require('../../config/database');
const logger = require('../../utils/logger');

const router = Router();

const VALID_TRIGGER_TYPES = ['review_sms', 'waitlist_notify'];

// ============================================
// GET /api/admin/automation — List all automation triggers
// ============================================
router.get('/', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;
    const result = await db.query(
      `SELECT id, type, is_active, config, updated_at, created_at
       FROM automation_triggers
       WHERE salon_id = $1
       ORDER BY created_at ASC`,
      [salonId]
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// ============================================
// PUT /api/admin/automation/:type — Update trigger config
// ============================================
router.put('/:type',
  [
    param('type').isIn(VALID_TRIGGER_TYPES).withMessage('Type d\'automatisation invalide'),
    body('is_active').optional().isBoolean().withMessage('is_active doit être un booléen'),
    body('config').optional().isObject().withMessage('config doit être un objet JSON'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { type } = req.params;
      const { is_active, config } = req.body;

      const fields = [];
      const values = [];
      let paramIndex = 1;

      if (is_active !== undefined) {
        fields.push(`is_active = $${paramIndex++}`);
        values.push(is_active);
      }

      if (config !== undefined) {
        fields.push(`config = $${paramIndex++}`);
        values.push(JSON.stringify(config));
      }

      if (fields.length === 0) {
        throw ApiError.badRequest('Aucune donnée à mettre à jour');
      }

      // Always update updated_at
      fields.push('updated_at = NOW()');

      const salonId = req.user.salon_id;
      values.push(type, salonId);
      const result = await db.query(
        `UPDATE automation_triggers SET ${fields.join(', ')}
         WHERE type = $${paramIndex} AND salon_id = $${paramIndex + 1}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Automatisation introuvable');
      }

      logger.info('Automation trigger updated', {
        type,
        is_active: result.rows[0].is_active,
      });

      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
