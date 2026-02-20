-- 006_recurrence.sql
-- Adds recurrence support: bookings in a recurring series share a recurrence_group_id

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recurrence_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_bookings_recurrence
  ON bookings(recurrence_group_id)
  WHERE recurrence_group_id IS NOT NULL;
