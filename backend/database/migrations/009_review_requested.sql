-- Add review_requested flag to clients
-- Tracks whether a client has already received a Google review SMS (once per lifetime)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS review_requested BOOLEAN DEFAULT false;
