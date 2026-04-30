const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const { ApiError } = require('../../utils/errors');
const db = require('../../config/database');
const {
  computeNextDueDate,
  validateRecurrenceConfig,
} = require('../../services/tasks');
const { getParisTodayISO } = require('../../utils/date');

const router = Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rowToTask(row) {
  return {
    id: row.id,
    salon_id: row.salon_id,
    title: row.title,
    description: row.description,
    assigned_to_barber_id: row.assigned_to_barber_id,
    assigned_to_name: row.assigned_to_name,
    assigned_barber_name: row.assigned_barber_name || null,
    assigned_barber_photo: row.assigned_barber_photo || null,
    due_date: row.due_date,
    is_recurring: row.is_recurring,
    recurrence_config: row.recurrence_config,
    next_due_date: row.next_due_date,
    is_active: row.is_active,
    completed_at: row.completed_at,
    last_completed_at: row.last_completed_at || null,
    last_completed_by_name: row.last_completed_by_name || null,
    completion_count: parseInt(row.completion_count || 0, 10),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const SELECT_TASK = `
  SELECT t.*,
         b.name AS assigned_barber_name,
         b.photo_url AS assigned_barber_photo,
         (SELECT MAX(completed_at) FROM task_completions WHERE task_id = t.id) AS last_completed_at,
         (SELECT br.name FROM task_completions tc
          LEFT JOIN barbers br ON tc.completed_by_barber_id = br.id
          WHERE tc.task_id = t.id ORDER BY tc.completed_at DESC LIMIT 1) AS last_completed_by_name,
         (SELECT COUNT(*) FROM task_completions WHERE task_id = t.id) AS completion_count
  FROM tasks t
  LEFT JOIN barbers b ON t.assigned_to_barber_id = b.id
`;

// ============================================
// GET /api/admin/tasks?status=todo|done|all&due=overdue|today|week|later|none
// ============================================
router.get('/',
  [
    query('status').optional().isIn(['todo', 'done', 'all']),
    query('due').optional().isIn(['overdue', 'today', 'week', 'later', 'none']),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const status = req.query.status || 'todo';
      const due = req.query.due;
      const today = getParisTodayISO();

      const conditions = [`t.salon_id = $1`, `t.is_active = true`];
      const params = [salonId];

      if (status === 'todo') {
        // One-shot: not yet completed. Recurring: always show (next_due_date drives display)
        conditions.push(`(
          (t.is_recurring = false AND t.completed_at IS NULL)
          OR t.is_recurring = true
        )`);
      } else if (status === 'done') {
        conditions.push(`(
          (t.is_recurring = false AND t.completed_at IS NOT NULL)
          OR (t.is_recurring = true AND EXISTS (SELECT 1 FROM task_completions WHERE task_id = t.id))
        )`);
      }

      if (due === 'overdue') {
        params.push(today);
        conditions.push(`COALESCE(t.next_due_date, t.due_date) < $${params.length}`);
      } else if (due === 'today') {
        params.push(today);
        conditions.push(`COALESCE(t.next_due_date, t.due_date) = $${params.length}`);
      } else if (due === 'week') {
        params.push(today);
        const idxToday = params.length;
        params.push(today);
        const idxToday2 = params.length;
        conditions.push(`COALESCE(t.next_due_date, t.due_date) BETWEEN $${idxToday} AND ($${idxToday2}::date + INTERVAL '7 days')`);
      } else if (due === 'later') {
        params.push(today);
        conditions.push(`COALESCE(t.next_due_date, t.due_date) > ($${params.length}::date + INTERVAL '7 days')`);
      } else if (due === 'none') {
        conditions.push(`COALESCE(t.next_due_date, t.due_date) IS NULL`);
      }

      const sql = `${SELECT_TASK}
        WHERE ${conditions.join(' AND ')}
        ORDER BY
          CASE WHEN COALESCE(t.next_due_date, t.due_date) IS NULL THEN 1 ELSE 0 END,
          COALESCE(t.next_due_date, t.due_date) ASC,
          t.created_at DESC`;

      const result = await db.query(sql, params);
      res.json(result.rows.map(rowToTask));
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/tasks/overdue/count
// ============================================
router.get('/overdue/count', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;
    const today = getParisTodayISO();
    const result = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM tasks
       WHERE salon_id = $1
         AND is_active = true
         AND COALESCE(next_due_date, due_date) < $2
         AND (
           (is_recurring = false AND completed_at IS NULL)
           OR is_recurring = true
         )`,
      [salonId, today]
    );
    res.json({ count: result.rows[0].count });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/admin/tasks/:id (with completion history)
// ============================================
router.get('/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const taskResult = await db.query(
        `${SELECT_TASK} WHERE t.id = $1 AND t.salon_id = $2`,
        [req.params.id, salonId]
      );
      if (taskResult.rows.length === 0) throw new ApiError(404, 'Task not found');

      const completionsResult = await db.query(
        `SELECT tc.id, tc.completed_at, tc.due_date_at_completion, tc.notes,
                tc.completed_by_barber_id, b.name AS completed_by_name
         FROM task_completions tc
         LEFT JOIN barbers b ON tc.completed_by_barber_id = b.id
         WHERE tc.task_id = $1
         ORDER BY tc.completed_at DESC
         LIMIT 50`,
        [req.params.id]
      );

      res.json({
        ...rowToTask(taskResult.rows[0]),
        completions: completionsResult.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/admin/tasks (create)
// ============================================
router.post('/',
  [
    body('title').isString().isLength({ min: 1, max: 200 }).trim(),
    body('description').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('assigned_to_barber_id').optional({ nullable: true }).matches(uuidRegex),
    body('assigned_to_name').optional({ nullable: true }).isString().isLength({ max: 100 }).trim(),
    body('due_date').optional({ nullable: true }).matches(/^\d{4}-\d{2}-\d{2}$/),
    body('is_recurring').isBoolean(),
    body('recurrence_config').optional({ nullable: true }).isObject(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const {
        title,
        description = null,
        assigned_to_barber_id = null,
        assigned_to_name = null,
        due_date = null,
        is_recurring,
        recurrence_config = null,
      } = req.body;

      // XOR enforcement (also enforced by DB CHECK)
      if (assigned_to_barber_id && assigned_to_name) {
        throw new ApiError(400, 'Choisir soit un barber soit un nom libre, pas les deux');
      }

      if (is_recurring) {
        if (!recurrence_config) throw new ApiError(400, 'recurrence_config requis');
        const err = validateRecurrenceConfig(recurrence_config);
        if (err) throw new ApiError(400, err);
      } else if (recurrence_config) {
        throw new ApiError(400, 'recurrence_config doit être null si is_recurring=false');
      }

      // If barber_id provided, verify it belongs to this salon
      if (assigned_to_barber_id) {
        const b = await db.query('SELECT salon_id FROM barbers WHERE id = $1', [assigned_to_barber_id]);
        if (b.rows.length === 0) throw new ApiError(400, 'Barber introuvable');
        if (b.rows[0].salon_id !== salonId) throw new ApiError(400, 'Barber appartient à un autre salon');
      }

      // Compute initial next_due_date for recurring tasks
      let nextDue = null;
      if (is_recurring) {
        const startFrom = due_date || getParisTodayISO();
        // For recurring, we want the "first occurrence" to be at or after startFrom.
        // computeNextDueDate jumps forward, so compute from (startFrom - 1 day).
        const start = new Date(startFrom);
        start.setUTCDate(start.getUTCDate() - 1);
        nextDue = computeNextDueDate(recurrence_config, start);
      }

      const result = await db.query(
        `INSERT INTO tasks (
           salon_id, title, description, assigned_to_barber_id, assigned_to_name,
           due_date, is_recurring, recurrence_config, next_due_date, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          salonId, title, description, assigned_to_barber_id, assigned_to_name,
          due_date, is_recurring, is_recurring ? recurrence_config : null, nextDue,
          req.user.id,
        ]
      );

      // Re-select with joins for full payload
      const full = await db.query(`${SELECT_TASK} WHERE t.id = $1`, [result.rows[0].id]);
      res.status(201).json(rowToTask(full.rows[0]));
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PUT /api/admin/tasks/:id
// ============================================
router.put('/:id',
  [
    param('id').matches(uuidRegex),
    body('title').optional().isString().isLength({ min: 1, max: 200 }).trim(),
    body('description').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('assigned_to_barber_id').optional({ nullable: true }).custom((v) => v === null || uuidRegex.test(v)),
    body('assigned_to_name').optional({ nullable: true }).isString().isLength({ max: 100 }).trim(),
    body('due_date').optional({ nullable: true }).custom((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v)),
    body('is_recurring').optional().isBoolean(),
    body('recurrence_config').optional({ nullable: true }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const existing = await db.query(
        `SELECT * FROM tasks WHERE id = $1 AND salon_id = $2`,
        [req.params.id, salonId]
      );
      if (existing.rows.length === 0) throw new ApiError(404, 'Task not found');
      const current = existing.rows[0];

      const merged = {
        title: req.body.title ?? current.title,
        description: req.body.description !== undefined ? req.body.description : current.description,
        assigned_to_barber_id:
          req.body.assigned_to_barber_id !== undefined
            ? req.body.assigned_to_barber_id
            : current.assigned_to_barber_id,
        assigned_to_name:
          req.body.assigned_to_name !== undefined
            ? req.body.assigned_to_name
            : current.assigned_to_name,
        due_date: req.body.due_date !== undefined ? req.body.due_date : current.due_date,
        is_recurring: req.body.is_recurring ?? current.is_recurring,
        recurrence_config:
          req.body.recurrence_config !== undefined
            ? req.body.recurrence_config
            : current.recurrence_config,
      };

      if (merged.assigned_to_barber_id && merged.assigned_to_name) {
        throw new ApiError(400, 'Choisir soit un barber soit un nom libre, pas les deux');
      }

      if (merged.is_recurring) {
        if (!merged.recurrence_config) throw new ApiError(400, 'recurrence_config requis');
        const err = validateRecurrenceConfig(merged.recurrence_config);
        if (err) throw new ApiError(400, err);
      } else {
        merged.recurrence_config = null;
      }

      if (merged.assigned_to_barber_id) {
        const b = await db.query('SELECT salon_id FROM barbers WHERE id = $1', [merged.assigned_to_barber_id]);
        if (b.rows.length === 0) throw new ApiError(400, 'Barber introuvable');
        if (b.rows[0].salon_id !== salonId) throw new ApiError(400, 'Barber appartient à un autre salon');
      }

      // Recompute next_due_date if recurrence config changed
      const recurrenceChanged =
        JSON.stringify(merged.recurrence_config) !== JSON.stringify(current.recurrence_config) ||
        merged.is_recurring !== current.is_recurring;

      let nextDue = current.next_due_date;
      if (merged.is_recurring && recurrenceChanged) {
        const startFrom = merged.due_date || getParisTodayISO();
        const start = new Date(startFrom);
        start.setUTCDate(start.getUTCDate() - 1);
        nextDue = computeNextDueDate(merged.recurrence_config, start);
      } else if (!merged.is_recurring) {
        nextDue = null;
      }

      await db.query(
        `UPDATE tasks SET
           title = $1, description = $2, assigned_to_barber_id = $3, assigned_to_name = $4,
           due_date = $5, is_recurring = $6, recurrence_config = $7, next_due_date = $8,
           updated_at = NOW()
         WHERE id = $9`,
        [
          merged.title, merged.description, merged.assigned_to_barber_id, merged.assigned_to_name,
          merged.due_date, merged.is_recurring, merged.recurrence_config, nextDue,
          req.params.id,
        ]
      );

      const full = await db.query(`${SELECT_TASK} WHERE t.id = $1`, [req.params.id]);
      res.json(rowToTask(full.rows[0]));
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/admin/tasks/:id (soft delete)
// ============================================
router.delete('/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const result = await db.query(
        `UPDATE tasks SET is_active = false, updated_at = NOW()
         WHERE id = $1 AND salon_id = $2
         RETURNING id`,
        [req.params.id, salonId]
      );
      if (result.rows.length === 0) throw new ApiError(404, 'Task not found');
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/admin/tasks/:id/complete
// ============================================
router.post('/:id/complete',
  [
    param('id').matches(uuidRegex),
    body('notes').optional({ nullable: true }).isString().isLength({ max: 1000 }),
  ],
  handleValidation,
  async (req, res, next) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const salonId = req.user.salon_id;
      const taskResult = await client.query(
        `SELECT * FROM tasks WHERE id = $1 AND salon_id = $2 AND is_active = true FOR UPDATE`,
        [req.params.id, salonId]
      );
      if (taskResult.rows.length === 0) {
        throw new ApiError(404, 'Task not found');
      }
      const task = taskResult.rows[0];

      // due_date_at_completion: for recurring, this is the next_due_date
      // For one-shot, this is the due_date (or NULL if no due date set)
      const dueDateAtCompletion = task.is_recurring ? task.next_due_date : task.due_date;

      // Idempotent insert via UNIQUE (task_id, due_date_at_completion)
      // If conflict, this is a duplicate click — return existing row.
      const completionResult = await client.query(
        `INSERT INTO task_completions (task_id, completed_by_barber_id, due_date_at_completion, notes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (task_id, due_date_at_completion) DO UPDATE SET notes = COALESCE(EXCLUDED.notes, task_completions.notes)
         RETURNING id, completed_at`,
        [req.params.id, req.user.id, dueDateAtCompletion, req.body.notes || null]
      );

      // Update task: one-shot → set completed_at; recurring → recompute next_due_date
      if (task.is_recurring) {
        const baseDate = dueDateAtCompletion || getParisTodayISO();
        const newNextDue = computeNextDueDate(task.recurrence_config, baseDate);
        await client.query(
          `UPDATE tasks SET next_due_date = $1, updated_at = NOW() WHERE id = $2`,
          [newNextDue, req.params.id]
        );
      } else {
        await client.query(
          `UPDATE tasks SET completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [req.params.id]
        );
      }

      await client.query('COMMIT');

      const full = await db.query(`${SELECT_TASK} WHERE t.id = $1`, [req.params.id]);
      res.json({
        task: rowToTask(full.rows[0]),
        completion_id: completionResult.rows[0].id,
        completed_at: completionResult.rows[0].completed_at,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  }
);

// ============================================
// POST /api/admin/tasks/:id/uncomplete (undo last completion)
// ============================================
router.post('/:id/uncomplete',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const salonId = req.user.salon_id;
      const taskResult = await client.query(
        `SELECT * FROM tasks WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
        [req.params.id, salonId]
      );
      if (taskResult.rows.length === 0) throw new ApiError(404, 'Task not found');
      const task = taskResult.rows[0];

      const lastResult = await client.query(
        `SELECT id, due_date_at_completion FROM task_completions
         WHERE task_id = $1 ORDER BY completed_at DESC LIMIT 1`,
        [req.params.id]
      );
      if (lastResult.rows.length === 0) throw new ApiError(400, 'Aucune complétion à annuler');

      await client.query(`DELETE FROM task_completions WHERE id = $1`, [lastResult.rows[0].id]);

      // Recompute next_due_date for recurring, or clear completed_at for one-shot
      if (task.is_recurring) {
        const previousResult = await client.query(
          `SELECT due_date_at_completion FROM task_completions
           WHERE task_id = $1 ORDER BY completed_at DESC LIMIT 1`,
          [req.params.id]
        );
        let newNextDue;
        if (previousResult.rows.length > 0) {
          newNextDue = computeNextDueDate(task.recurrence_config, previousResult.rows[0].due_date_at_completion);
        } else {
          // Reset to first occurrence based on due_date or today
          const startFrom = task.due_date || getParisTodayISO();
          const start = new Date(startFrom);
          start.setUTCDate(start.getUTCDate() - 1);
          newNextDue = computeNextDueDate(task.recurrence_config, start);
        }
        await client.query(
          `UPDATE tasks SET next_due_date = $1, updated_at = NOW() WHERE id = $2`,
          [newNextDue, req.params.id]
        );
      } else {
        await client.query(
          `UPDATE tasks SET completed_at = NULL, updated_at = NOW() WHERE id = $1`,
          [req.params.id]
        );
      }

      await client.query('COMMIT');

      const full = await db.query(`${SELECT_TASK} WHERE t.id = $1`, [req.params.id]);
      res.json(rowToTask(full.rows[0]));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  }
);

module.exports = router;
