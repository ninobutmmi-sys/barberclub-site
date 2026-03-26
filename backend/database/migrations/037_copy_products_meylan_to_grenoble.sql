-- Migration 037: Copy Meylan products to Grenoble (stock_quantity = 0, to be filled manually)
-- Only copies products that don't already exist in Grenoble (by name)

INSERT INTO products (name, description, category, buy_price, sell_price, stock_quantity, alert_threshold, sku, is_active, sellable, salon_id)
SELECT
  p.name,
  p.description,
  p.category,
  p.buy_price,
  p.sell_price,
  0 AS stock_quantity,
  p.alert_threshold,
  p.sku,
  p.is_active,
  p.sellable,
  'grenoble' AS salon_id
FROM products p
WHERE p.salon_id = 'meylan'
  AND p.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM products p2
    WHERE p2.salon_id = 'grenoble' AND p2.name = p.name
  );
