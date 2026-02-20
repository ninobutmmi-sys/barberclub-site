-- Migration 008: Add password reset token columns to clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;
