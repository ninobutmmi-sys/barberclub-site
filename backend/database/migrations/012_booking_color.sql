-- Migration 012: Add optional color override on bookings
-- Allows admin to set a custom color per booking (overrides service color)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS color VARCHAR(7);
