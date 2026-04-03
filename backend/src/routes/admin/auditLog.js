const { Router } = require('express');
const db = require('../../config/database');

const router = Router();

// ============================================
// GET /api/admin/audit-log — List audit entries
// ============================================
router.get('/', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;
    const { action, entity_type, entity_id, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const conditions = ['salon_id = $1'];
    const values = [salonId];
    let idx = 2;

    if (action) {
      conditions.push(`action = $${idx++}`);
      values.push(action);
    }
    if (entity_type) {
      conditions.push(`entity_type = $${idx++}`);
      values.push(entity_type);
    }
    if (entity_id) {
      conditions.push(`entity_id = $${idx++}`);
      values.push(entity_id);
    }

    const where = conditions.join(' AND ');

    const [rows, countResult] = await Promise.all([
      db.query(
        `SELECT id, actor_name, action, entity_type, entity_id, details, ip_address, created_at
         FROM audit_log WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, parseInt(limit), offset]
      ),
      db.query(
        `SELECT COUNT(*) FROM audit_log WHERE ${where}`,
        values
      ),
    ]);

    res.json({
      entries: rows.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
