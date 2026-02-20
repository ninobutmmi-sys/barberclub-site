-- ============================================
-- Migration 004: Cash Register (Caisse)
-- Tables: payments, register_closings
-- ============================================

-- Payments: track each payment (CB, cash, lydia, other)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  method VARCHAR(20) NOT NULL CHECK (method IN ('cb', 'cash', 'lydia', 'other')),
  note TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by UUID NOT NULL REFERENCES barbers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for daily lookups
CREATE INDEX idx_payments_paid_at ON payments (paid_at);
CREATE INDEX idx_payments_booking_id ON payments (booking_id);

-- Register closings: end-of-day summary
CREATE TABLE IF NOT EXISTS register_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  total_cb INTEGER NOT NULL DEFAULT 0,
  total_cash INTEGER NOT NULL DEFAULT 0,
  total_other INTEGER NOT NULL DEFAULT 0,
  booking_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  closed_by UUID NOT NULL REFERENCES barbers(id),
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_register_closings_date ON register_closings (date);
