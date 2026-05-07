-- Migration 051: Twilio SMS delivery webhook log
-- Mirrors brevo_sms_events but for Twilio status callbacks.
-- Twilio sends each status change (queued, sending, sent, delivered, undelivered, failed)
-- to our webhook. We log every event for audit + update notification_queue.delivery_status.

CREATE TABLE IF NOT EXISTS twilio_sms_events (
  id BIGSERIAL PRIMARY KEY,
  message_sid TEXT NOT NULL,
  status TEXT NOT NULL,         -- queued | sending | sent | delivered | undelivered | failed
  recipient TEXT,
  error_code TEXT,              -- Twilio error code (e.g. 30003, 30004)
  error_message TEXT,
  raw_payload JSONB,
  processed BOOLEAN DEFAULT false,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS twilio_sms_events_uniq
  ON twilio_sms_events (message_sid, status);

CREATE INDEX IF NOT EXISTS twilio_sms_events_recv_idx
  ON twilio_sms_events (received_at DESC);
