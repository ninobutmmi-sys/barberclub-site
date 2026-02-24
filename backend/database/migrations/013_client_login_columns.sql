-- Migration 013: Add login security columns to clients table
-- Fixes: client login returns 500 because these columns don't exist
-- The auth login route queries failed_login_attempts and locked_until on both barbers and clients tables

ALTER TABLE clients ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
