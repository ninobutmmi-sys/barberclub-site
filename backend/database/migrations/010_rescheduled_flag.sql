-- Migration 010: Add rescheduled flag to bookings
-- Tracks whether a booking has already been rescheduled by the client (limit: 1 time)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rescheduled BOOLEAN DEFAULT false;
