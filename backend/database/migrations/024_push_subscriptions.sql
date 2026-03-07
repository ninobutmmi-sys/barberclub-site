-- Migration 024: Push notification subscriptions
-- Stores Web Push subscriptions for dashboard users (barbers)

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  salon_id VARCHAR(50) NOT NULL DEFAULT 'meylan',
  endpoint TEXT NOT NULL,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (endpoint)
);

CREATE INDEX idx_push_sub_salon ON push_subscriptions (salon_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
