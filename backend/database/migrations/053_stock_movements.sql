-- Migration 053: Stock movements (retraits de stock SANS impact CA)
-- Les barbers consomment des produits pour coiffer (cire, etc.) ou constatent
-- une perte/casse/correction d'inventaire. Ces retraits décrémentent le stock
-- mais ne doivent PAS compter comme des ventes (product_sales = CA).
-- La vente réelle aux clients passe par le modal du RDV (product_sales).

CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    salon_id VARCHAR(20) NOT NULL REFERENCES salons(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),   -- quantité retirée (positive)
    reason VARCHAR(20) NOT NULL CHECK (reason IN ('internal_use', 'loss', 'inventory')),
    note TEXT CHECK (note IS NULL OR length(note) <= 500),
    performed_by UUID REFERENCES barbers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stock_movements_product ON stock_movements (product_id, created_at DESC);
CREATE INDEX idx_stock_movements_salon ON stock_movements (salon_id, created_at DESC);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
