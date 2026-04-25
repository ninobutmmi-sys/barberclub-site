-- Migration 047: Brevo traceability + credits tracking
--
-- Context: Brevo support refuses to investigate missing SMS without the messageId
-- returned by their API. We now persist this ID on each send so Julien can give it
-- to Brevo support directly instead of digging through their UI.
--
-- Also tracks remainingCredits returned by each SMS send, so we can alert when
-- the balance is low (avoid silent outages like Grenoble running out of credits).

-- 1. Provider message ID returned by Brevo on successful send
ALTER TABLE notification_queue
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_notification_queue_provider_message_id
  ON notification_queue (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- 2. Credit balance log — one row per SMS send, captures remainingCredits
-- (trimmed to 30 days by the cleanup cron)
CREATE TABLE IF NOT EXISTS brevo_credit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id        VARCHAR(32) NOT NULL,
  remaining_credits NUMERIC(10, 2) NOT NULL,
  used_credits    NUMERIC(10, 2),
  sms_count       INT,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brevo_credit_log_salon_recorded
  ON brevo_credit_log (salon_id, recorded_at DESC);
