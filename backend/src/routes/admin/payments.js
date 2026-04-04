const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const { ApiError } = require('../../utils/errors');
const db = require('../../config/database');
const { getParisTodayISO } = require('../../utils/date');

const router = Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// GET /api/admin/payments/daily?date=YYYY-MM-DD
// Daily summary: bookings, payments, totals, closing status
// ============================================
router.get('/daily',
  [
    query('date').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const targetDate = req.query.date || getParisTodayISO();

      // 1. Get completed bookings for the date with any linked payment
      const bookingsResult = await db.query(
        `SELECT b.id, b.date, b.start_time, b.end_time, b.status, b.price,
                s.name as service_name,
                br.name as barber_name,
                c.first_name as client_first_name,
                c.last_name as client_last_name,
                c.phone as client_phone,
                p.id as payment_id, p.amount as payment_amount,
                p.method as payment_method, p.note as payment_note
         FROM bookings b
         JOIN services s ON b.service_id = s.id
         JOIN barbers br ON b.barber_id = br.id
         JOIN clients c ON b.client_id = c.id
         LEFT JOIN payments p ON p.booking_id = b.id
         WHERE b.date = $1
           AND b.salon_id = $2
           AND b.status = 'completed'
           AND b.deleted_at IS NULL
         ORDER BY b.start_time`,
        [targetDate, salonId]
      );

      // 2. Get standalone payments (not linked to a booking) for the date
      const standaloneResult = await db.query(
        `SELECT p.id, p.amount, p.method, p.note, p.paid_at, p.recorded_by,
                br.name as recorded_by_name
         FROM payments p
         JOIN barbers br ON p.recorded_by = br.id
         WHERE p.booking_id IS NULL
           AND p.salon_id = $1
           AND p.paid_at::date = $2
         ORDER BY p.paid_at`,
        [salonId, targetDate]
      );

      // 3. Calculate totals from all payments for the date
      const totalsResult = await db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN method = 'cb' THEN amount ELSE 0 END), 0) as total_cb,
           COALESCE(SUM(CASE WHEN method = 'cash' THEN amount ELSE 0 END), 0) as total_cash,
           COALESCE(SUM(CASE WHEN method = 'lydia' THEN amount ELSE 0 END), 0) as total_lydia,
           COALESCE(SUM(CASE WHEN method = 'other' THEN amount ELSE 0 END), 0) as total_other,
           COALESCE(SUM(amount), 0) as grand_total,
           COUNT(*) as payment_count
         FROM payments
         WHERE salon_id = $1 AND paid_at::date = $2`,
        [salonId, targetDate]
      );

      // 4. Check if day is closed
      const closingResult = await db.query(
        'SELECT * FROM register_closings WHERE salon_id = $1 AND date = $2',
        [salonId, targetDate]
      );

      res.json({
        date: targetDate,
        bookings: bookingsResult.rows,
        standalone_payments: standaloneResult.rows,
        totals: totalsResult.rows[0],
        closing: closingResult.rows[0] || null,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/admin/payments — Record a payment
// ============================================
router.post('/',
  [
    body('booking_id').optional({ values: 'falsy' }).matches(uuidRegex).withMessage('ID réservation invalide'),
    body('amount').isInt({ min: 1 }).withMessage('Montant requis (en centimes)'),
    body('method').isIn(['cb', 'cash', 'lydia', 'other']).withMessage('Méthode invalide'),
    body('note').optional({ values: 'falsy' }).isString().trim(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { booking_id, amount, method, note } = req.body;
      const recorded_by = req.user.id;

      // If linked to a booking, check that it exists and belongs to this salon
      if (booking_id) {
        const bookingCheck = await db.query(
          'SELECT id FROM bookings WHERE id = $1 AND salon_id = $2 AND deleted_at IS NULL',
          [booking_id, salonId]
        );
        if (bookingCheck.rows.length === 0) {
          throw ApiError.notFound('Réservation introuvable');
        }

        // Remove any existing payment for this booking (replace)
        await db.query('DELETE FROM payments WHERE booking_id = $1', [booking_id]);
      }

      // Check that the date is not already closed
      const paidAt = new Date();
      const dateStr = getParisTodayISO();
      const closingCheck = await db.query(
        'SELECT id FROM register_closings WHERE salon_id = $1 AND date = $2',
        [salonId, dateStr]
      );
      if (closingCheck.rows.length > 0) {
        throw ApiError.badRequest('La caisse est déjà clôturée pour cette date');
      }

      const result = await db.query(
        `INSERT INTO payments (booking_id, amount, method, note, recorded_by, paid_at, salon_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [booking_id || null, amount, method, note || null, recorded_by, paidAt, salonId]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/admin/payments/:id — Remove a payment
// ============================================
router.delete('/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      // Check that the payment's date is not closed
      const payment = await db.query(
        'SELECT id, paid_at FROM payments WHERE id = $1 AND salon_id = $2',
        [req.params.id, salonId]
      );
      if (payment.rows.length === 0) {
        throw ApiError.notFound('Paiement introuvable');
      }

      const dateStr = new Date(payment.rows[0].paid_at).toISOString().split('T')[0];
      const closingCheck = await db.query(
        'SELECT id FROM register_closings WHERE salon_id = $1 AND date = $2',
        [salonId, dateStr]
      );
      if (closingCheck.rows.length > 0) {
        throw ApiError.badRequest('La caisse est déjà clôturée pour cette date');
      }

      await db.query('DELETE FROM payments WHERE id = $1 AND salon_id = $2', [req.params.id, salonId]);
      res.json({ message: 'Paiement supprimé' });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/admin/payments/close — Close the register for a date
// ============================================
router.post('/close',
  [
    body('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date invalide'),
    body('notes').optional({ values: 'falsy' }).isString().trim(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { date, notes } = req.body;
      const closed_by = req.user.id;

      // Check not already closed
      const existing = await db.query(
        'SELECT id FROM register_closings WHERE salon_id = $1 AND date = $2',
        [salonId, date]
      );
      if (existing.rows.length > 0) {
        throw ApiError.badRequest('La caisse est déjà clôturée pour cette date');
      }

      // Calculate totals from payments
      const totals = await db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN method = 'cb' THEN amount ELSE 0 END), 0) as total_cb,
           COALESCE(SUM(CASE WHEN method = 'cash' THEN amount ELSE 0 END), 0) as total_cash,
           COALESCE(SUM(CASE WHEN method NOT IN ('cb', 'cash') THEN amount ELSE 0 END), 0) as total_other
         FROM payments
         WHERE salon_id = $1 AND paid_at::date = $2`,
        [salonId, date]
      );

      // Count bookings with payments for that date
      const bookingCount = await db.query(
        `SELECT COUNT(DISTINCT p.booking_id) as cnt
         FROM payments p
         WHERE p.booking_id IS NOT NULL
           AND p.salon_id = $1
           AND p.paid_at::date = $2`,
        [salonId, date]
      );

      const { total_cb, total_cash, total_other } = totals.rows[0];
      const booking_count = parseInt(bookingCount.rows[0].cnt, 10);

      const result = await db.query(
        `INSERT INTO register_closings (date, total_cb, total_cash, total_other, booking_count, notes, closed_by, salon_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [date, total_cb, total_cash, total_other, booking_count, notes || null, closed_by, salonId]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/payments/closings?from=&to= — List past closings
// ============================================
router.get('/closings',
  [
    query('from').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('to').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const conditions = [`rc.salon_id = $1`];
      const params = [salonId];
      let paramIndex = 2;

      if (req.query.from) {
        conditions.push(`rc.date >= $${paramIndex}`);
        params.push(req.query.from);
        paramIndex++;
      }

      if (req.query.to) {
        conditions.push(`rc.date <= $${paramIndex}`);
        params.push(req.query.to);
        paramIndex++;
      }

      const whereClause = 'WHERE ' + conditions.join(' AND ');

      const result = await db.query(
        `SELECT rc.*, br.name as closed_by_name
         FROM register_closings rc
         JOIN barbers br ON rc.closed_by = br.id
         ${whereClause}
         ORDER BY rc.date DESC`,
        params
      );

      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
