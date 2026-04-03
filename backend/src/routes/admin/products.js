const { Router } = require('express');
const { body, param, query } = require('express-validator');
const crypto = require('crypto');
const { handleValidation } = require('../../middleware/validate');
const { ApiError } = require('../../utils/errors');
const db = require('../../config/database');
const logger = require('../../utils/logger');

const router = Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// GET /api/admin/products — List products
// ?category=...  ?low_stock=true
// ============================================
router.get('/',
  [
    query('category').optional().trim().isLength({ max: 100 }),
    query('low_stock').optional().isIn(['true', 'false']),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { category, low_stock } = req.query;

      const conditions = [`p.salon_id = $1`];
      const params = [salonId];
      let paramIndex = 2;

      if (category) {
        conditions.push(`p.category = $${paramIndex}`);
        params.push(category);
        paramIndex++;
      }

      if (low_stock === 'true') {
        conditions.push('p.stock_quantity <= p.alert_threshold');
      }

      const whereClause = 'WHERE ' + conditions.join(' AND ');

      const result = await db.query(
        `SELECT p.id, p.name, p.description, p.category, p.buy_price, p.sell_price,
                p.stock_quantity, p.alert_threshold, p.sku, p.is_active, p.sellable, p.created_at
         FROM products p
         ${whereClause}
         ORDER BY p.category, p.name`,
        params
      );

      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/products/sales — Sales with date range
// ?from=YYYY-MM-DD  ?to=YYYY-MM-DD
// ============================================
router.get('/sales',
  [
    query('from').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('to').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { from, to } = req.query;

      const conditions = [`p.salon_id = $1`];
      const params = [salonId];
      let paramIndex = 2;

      if (from) {
        conditions.push(`ps.sold_at >= $${paramIndex}::date`);
        params.push(from);
        paramIndex++;
      }

      if (to) {
        conditions.push(`ps.sold_at < ($${paramIndex}::date + INTERVAL '1 day')`);
        params.push(to);
        paramIndex++;
      }

      const whereClause = 'WHERE ' + conditions.join(' AND ');

      const salesResult = await db.query(
        `SELECT ps.id, ps.quantity, ps.unit_price, ps.total_price, ps.payment_method,
                ps.sold_at, ps.created_at,
                p.name as product_name, p.category as product_category,
                b.name as barber_name,
                c.first_name as client_first_name, c.last_name as client_last_name
         FROM product_sales ps
         JOIN products p ON ps.product_id = p.id
         LEFT JOIN barbers b ON ps.sold_by = b.id
         LEFT JOIN clients c ON ps.client_id = c.id
         ${whereClause}
         ORDER BY ps.sold_at DESC`,
        params
      );

      // Calculate total revenue for the filtered period
      const revenueResult = await db.query(
        `SELECT COALESCE(SUM(ps.total_price), 0) as total_revenue,
                COUNT(*) as sale_count
         FROM product_sales ps
         JOIN products p ON ps.product_id = p.id
         ${whereClause}`,
        params
      );

      res.json({
        sales: salesResult.rows,
        total_revenue: parseInt(revenueResult.rows[0].total_revenue, 10),
        sale_count: parseInt(revenueResult.rows[0].sale_count, 10),
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/products/gift-cards — List all gift cards
// ============================================
router.get('/gift-cards', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;
    const result = await db.query(
      `SELECT gc.id, gc.code, gc.initial_amount, gc.balance, gc.buyer_name,
              gc.recipient_name, gc.recipient_email, gc.payment_method,
              gc.is_active, gc.expires_at, gc.created_at,
              b.name as sold_by_name,
              c.first_name as buyer_first_name, c.last_name as buyer_last_name
       FROM gift_cards gc
       LEFT JOIN barbers b ON gc.sold_by = b.id
       LEFT JOIN clients c ON gc.buyer_client_id = c.id
       WHERE gc.salon_id = $1
       ORDER BY gc.created_at DESC`,
      [salonId]
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/admin/products/stats — Product sales stats
// ============================================
router.get('/stats', async (req, res, next) => {
  try {
    const salonId = req.user.salon_id;
    const today = new Date().toISOString().split('T')[0];

    // Revenue today
    const todayResult = await db.query(
      `SELECT COALESCE(SUM(ps.total_price), 0) as revenue_today,
              COUNT(*) as sales_today
       FROM product_sales ps
       JOIN products p ON ps.product_id = p.id
       WHERE p.salon_id = $1 AND ps.sold_at::date = $2`,
      [salonId, today]
    );

    // Revenue this month
    const monthResult = await db.query(
      `SELECT COALESCE(SUM(ps.total_price), 0) as revenue_month,
              COUNT(*) as sales_month
       FROM product_sales ps
       JOIN products p ON ps.product_id = p.id
       WHERE p.salon_id = $1
         AND ps.sold_at >= date_trunc('month', CURRENT_DATE)
         AND ps.sold_at < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'`,
      [salonId]
    );

    // Low stock alerts count
    const lowStockResult = await db.query(
      `SELECT COUNT(*) as low_stock_count
       FROM products
       WHERE salon_id = $1
         AND stock_quantity <= alert_threshold
         AND is_active = true`,
      [salonId]
    );

    res.json({
      revenue_today: parseInt(todayResult.rows[0].revenue_today, 10),
      sales_today: parseInt(todayResult.rows[0].sales_today, 10),
      revenue_month: parseInt(monthResult.rows[0].revenue_month, 10),
      sales_month: parseInt(monthResult.rows[0].sales_month, 10),
      low_stock_count: parseInt(lowStockResult.rows[0].low_stock_count, 10),
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/admin/products — Create a product
// ============================================
router.post('/',
  [
    body('name').trim().notEmpty().withMessage('Nom requis').isLength({ max: 200 }),
    body('description').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
    body('category').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
    body('buy_price').optional({ values: 'falsy' }).isInt({ min: 0 }).withMessage('Prix d\'achat invalide (en centimes)'),
    body('sell_price').isInt({ min: 0 }).withMessage('Prix de vente requis (en centimes)'),
    body('stock_quantity').isInt({ min: 0 }).withMessage('Quantite en stock requise'),
    body('alert_threshold').optional().isInt({ min: 0 }).withMessage('Seuil d\'alerte invalide'),
    body('sku').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
    body('sellable').optional().isBoolean(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { name, description, category, buy_price, sell_price, stock_quantity, alert_threshold, sku, sellable } = req.body;

      const result = await db.query(
        `INSERT INTO products (name, description, category, buy_price, sell_price, stock_quantity, alert_threshold, sku, sellable, salon_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          name,
          description || null,
          category || null,
          buy_price || 0,
          sell_price,
          stock_quantity,
          alert_threshold != null ? alert_threshold : 5,
          sku || null,
          sellable != null ? sellable : true,
          salonId,
        ]
      );

      logger.info('Product created', { product_id: result.rows[0].id, name });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/admin/products/gift-cards — Create a gift card
// ============================================
router.post('/gift-cards',
  [
    body('initial_amount').isInt({ min: 100 }).withMessage('Montant minimum 1 EUR (100 centimes)'),
    body('buyer_name').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('buyer_client_id').optional({ values: 'falsy' }).matches(uuidRegex),
    body('recipient_name').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('recipient_email').optional({ values: 'falsy' }).isEmail().normalizeEmail(),
    body('payment_method').isIn(['cb', 'cash', 'lydia', 'other']).withMessage('Methode de paiement invalide'),
    body('sold_by').matches(uuidRegex).withMessage('Vendeur requis'),
    body('expires_at').optional({ values: 'falsy' }).matches(/^\d{4}-\d{2}-\d{2}$/),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const {
        initial_amount, buyer_name, buyer_client_id,
        recipient_name, recipient_email, payment_method,
        sold_by, expires_at,
      } = req.body;

      // Generate unique gift card code: GC-XXXX-XXXX
      let code;
      let codeExists = true;

      while (codeExists) {
        code = 'GC-'
          + crypto.randomBytes(2).toString('hex').toUpperCase()
          + '-'
          + crypto.randomBytes(2).toString('hex').toUpperCase();

        const check = await db.query('SELECT id FROM gift_cards WHERE code = $1', [code]);
        codeExists = check.rows.length > 0;
      }

      const result = await db.query(
        `INSERT INTO gift_cards (code, initial_amount, balance, buyer_name, buyer_client_id,
                                 recipient_name, recipient_email, payment_method, sold_by, expires_at, salon_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          code,
          initial_amount,
          initial_amount, // balance = initial_amount at creation
          buyer_name || null,
          buyer_client_id || null,
          recipient_name || null,
          recipient_email || null,
          payment_method,
          sold_by,
          expires_at || null,
          salonId,
        ]
      );

      logger.info('Gift card created', { gift_card_id: result.rows[0].id, code });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PUT /api/admin/products/:id — Update a product
// ============================================
router.put('/:id',
  [
    param('id').matches(uuidRegex),
    body('name').optional().trim().notEmpty().isLength({ max: 200 }),
    body('description').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
    body('category').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
    body('buy_price').optional().isInt({ min: 0 }),
    body('sell_price').optional().isInt({ min: 0 }),
    body('stock_quantity').optional().isInt({ min: 0 }),
    body('alert_threshold').optional().isInt({ min: 0 }),
    body('sku').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
    body('is_active').optional().isBoolean(),
    body('sellable').optional().isBoolean(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { id } = req.params;
      const { name, description, category, buy_price, sell_price, stock_quantity, alert_threshold, sku, is_active, sellable } = req.body;

      const fields = [];
      const values = [];
      let paramIndex = 1;

      if (name !== undefined) { fields.push(`name = $${paramIndex++}`); values.push(name); }
      if (description !== undefined) { fields.push(`description = $${paramIndex++}`); values.push(description || null); }
      if (category !== undefined) { fields.push(`category = $${paramIndex++}`); values.push(category || null); }
      if (buy_price !== undefined) { fields.push(`buy_price = $${paramIndex++}`); values.push(buy_price); }
      if (sell_price !== undefined) { fields.push(`sell_price = $${paramIndex++}`); values.push(sell_price); }
      if (stock_quantity !== undefined) { fields.push(`stock_quantity = $${paramIndex++}`); values.push(stock_quantity); }
      if (alert_threshold !== undefined) { fields.push(`alert_threshold = $${paramIndex++}`); values.push(alert_threshold); }
      if (sku !== undefined) { fields.push(`sku = $${paramIndex++}`); values.push(sku || null); }
      if (is_active !== undefined) { fields.push(`is_active = $${paramIndex++}`); values.push(is_active); }
      if (sellable !== undefined) { fields.push(`sellable = $${paramIndex++}`); values.push(sellable); }

      if (fields.length === 0) {
        throw ApiError.badRequest('Aucune donnee a mettre a jour');
      }

      values.push(id, salonId);
      const result = await db.query(
        `UPDATE products SET ${fields.join(', ')}
         WHERE id = $${paramIndex} AND salon_id = $${paramIndex + 1}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Produit introuvable');
      }

      logger.info('Product updated', { product_id: id });
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PUT /api/admin/products/gift-cards/:id — Update a gift card
// ============================================
router.put('/gift-cards/:id',
  [
    param('id').matches(uuidRegex),
    body('balance').optional().isInt({ min: 0 }),
    body('is_active').optional().isBoolean(),
    body('recipient_name').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('recipient_email').optional({ values: 'falsy' }).isEmail().normalizeEmail(),
    body('expires_at').optional({ values: 'falsy' }).matches(/^\d{4}-\d{2}-\d{2}$/),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { id } = req.params;
      const { balance, is_active, recipient_name, recipient_email, expires_at } = req.body;

      const fields = [];
      const values = [];
      let paramIndex = 1;

      if (balance !== undefined) { fields.push(`balance = $${paramIndex++}`); values.push(balance); }
      if (is_active !== undefined) { fields.push(`is_active = $${paramIndex++}`); values.push(is_active); }
      if (recipient_name !== undefined) { fields.push(`recipient_name = $${paramIndex++}`); values.push(recipient_name || null); }
      if (recipient_email !== undefined) { fields.push(`recipient_email = $${paramIndex++}`); values.push(recipient_email || null); }
      if (expires_at !== undefined) { fields.push(`expires_at = $${paramIndex++}`); values.push(expires_at || null); }

      if (fields.length === 0) {
        throw ApiError.badRequest('Aucune donnee a mettre a jour');
      }

      values.push(id, salonId);
      const result = await db.query(
        `UPDATE gift_cards SET ${fields.join(', ')}
         WHERE id = $${paramIndex} AND salon_id = $${paramIndex + 1}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Carte cadeau introuvable');
      }

      logger.info('Gift card updated', { gift_card_id: id, fields: Object.keys(req.body) });
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/admin/products/:id/sale — Record a product sale
// ============================================
router.post('/:id/sale',
  [
    param('id').matches(uuidRegex),
    body('quantity').isInt({ min: 1 }).withMessage('Quantite requise (min 1)'),
    body('payment_method').isIn(['cb', 'cash', 'lydia', 'other']).withMessage('Methode de paiement invalide'),
    body('sold_by').matches(uuidRegex).withMessage('Vendeur requis'),
    body('client_id').optional({ values: 'falsy' }).matches(uuidRegex),
    body('booking_id').optional({ values: 'falsy' }).matches(uuidRegex),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { id } = req.params;
      const { quantity, payment_method, sold_by, client_id, booking_id } = req.body;

      // Get product and check availability
      const productResult = await db.query(
        'SELECT id, name, sell_price, stock_quantity, is_active FROM products WHERE id = $1 AND salon_id = $2',
        [id, salonId]
      );

      if (productResult.rows.length === 0) {
        throw ApiError.notFound('Produit introuvable');
      }

      const product = productResult.rows[0];

      if (!product.is_active) {
        throw ApiError.badRequest('Ce produit est desactive');
      }

      if (product.stock_quantity < quantity) {
        throw ApiError.badRequest(
          `Stock insuffisant (disponible: ${product.stock_quantity}, demande: ${quantity})`
        );
      }

      const unit_price = product.sell_price;
      const total_price = unit_price * quantity;

      // Decrease stock
      await db.query(
        'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
        [quantity, id]
      );

      // Create sale record
      const saleResult = await db.query(
        `INSERT INTO product_sales (product_id, quantity, unit_price, total_price, payment_method, sold_by, client_id, booking_id, sold_at, salon_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
         RETURNING *`,
        [id, quantity, unit_price, total_price, payment_method, sold_by, client_id || null, booking_id || null, salonId]
      );

      logger.info('Product sale recorded', {
        product_id: id,
        product_name: product.name,
        quantity,
        total_price,
      });

      // Return sale with updated stock info
      res.status(201).json({
        ...saleResult.rows[0],
        product_name: product.name,
        new_stock_quantity: product.stock_quantity - quantity,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/admin/products/sales/:saleId — Cancel a sale (rollback stock)
// ============================================
router.delete('/sales/:saleId',
  [param('saleId').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const { saleId } = req.params;

      const sale = await db.query(
        'SELECT id, product_id, quantity FROM product_sales WHERE id = $1 AND salon_id = $2',
        [saleId, salonId]
      );
      if (sale.rows.length === 0) throw ApiError.notFound('Vente introuvable');

      const { product_id, quantity } = sale.rows[0];

      // Rollback stock
      await db.query(
        'UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2',
        [quantity, product_id]
      );

      // Delete sale
      await db.query('DELETE FROM product_sales WHERE id = $1', [saleId]);

      logger.info('Product sale cancelled', { saleId, product_id, quantity_restored: quantity });
      res.json({ ok: true, message: 'Vente annulée, stock restauré' });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/admin/products/sales/booking/:bookingId — Get sales for a booking
// ============================================
router.get('/sales/booking/:bookingId',
  [param('bookingId').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const result = await db.query(
        `SELECT ps.id, ps.product_id, ps.quantity, ps.unit_price, ps.total_price,
                p.name as product_name, p.category
         FROM product_sales ps
         JOIN products p ON ps.product_id = p.id
         WHERE ps.booking_id = $1 AND ps.salon_id = $2
         ORDER BY ps.sold_at`,
        [req.params.bookingId, salonId]
      );
      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/admin/products/:id — Soft delete (is_active = false)
// ============================================
router.delete('/:id',
  [param('id').matches(uuidRegex)],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const result = await db.query(
        'UPDATE products SET is_active = false WHERE id = $1 AND salon_id = $2 AND is_active = true RETURNING id, name',
        [req.params.id, salonId]
      );

      if (result.rows.length === 0) {
        throw ApiError.notFound('Produit introuvable ou deja desactive');
      }

      logger.info('Product deactivated', { product_id: result.rows[0].id, name: result.rows[0].name });
      res.json({ message: 'Produit desactive' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
