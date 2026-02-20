-- ============================================
-- Migration 003: Blocked Slots
-- Allows barbers to block time slots for breaks,
-- personal appointments, or half-day closures.
-- ============================================

CREATE TABLE IF NOT EXISTS blocked_slots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id   UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  reason      VARCHAR(255),
  type        VARCHAR(50) NOT NULL CHECK (type IN ('break', 'personal', 'closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent exact duplicate blocks
  CONSTRAINT blocked_slots_no_overlap UNIQUE (barber_id, date, start_time, end_time)
);

-- Index for fast lookup by barber + date (planning view)
CREATE INDEX IF NOT EXISTS idx_blocked_slots_barber_date
  ON blocked_slots (barber_id, date);

-- Index for date range queries (week view)
CREATE INDEX IF NOT EXISTS idx_blocked_slots_date
  ON blocked_slots (date);
