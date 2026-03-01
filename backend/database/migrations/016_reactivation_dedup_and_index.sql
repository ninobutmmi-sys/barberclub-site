-- 016: Add reactivation SMS dedup column + index on recurrence_group_id
-- Prevents sending the same reactivation SMS every 10 minutes

ALTER TABLE clients ADD COLUMN IF NOT EXISTS reactivation_sms_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bookings_recurrence_group_id ON bookings(recurrence_group_id) WHERE recurrence_group_id IS NOT NULL;
