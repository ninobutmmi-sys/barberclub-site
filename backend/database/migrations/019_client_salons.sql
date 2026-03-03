-- ============================================
-- Migration 019: Client-Salon relationship
-- Tracks which salon(s) a client belongs to
-- Enables per-salon SMS campaigns
-- ============================================

CREATE TABLE IF NOT EXISTS client_salons (
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  salon_id VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (client_id, salon_id)
);

CREATE INDEX IF NOT EXISTS idx_client_salons_salon ON client_salons(salon_id);
