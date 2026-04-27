-- Migration 048: Brevo SMS delivery tracking via webhooks
--
-- Context: Brevo SMS API renvoie 200 OK + messageId même quand le SMS sera
-- ensuite rejeté par le carrier (crédits insuffisants, blacklist, format).
-- Notre queue marque "sent" mais le client ne reçoit jamais le SMS.
--
-- Solution: webhook Brevo qui pousse les events delivered/rejected/bounced
-- en temps réel. On persiste le statut delivery réel séparément du statut
-- d'envoi API.
--
-- Aussi: blacklist auto par numéro après hardBounce/blacklisted pour ne
-- plus brûler de crédits sur un numéro qui ne marchera jamais.

-- 1. Statut delivery réel (séparé de status='sent' qui = "API a accepté")
ALTER TABLE notification_queue
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_event_at TIMESTAMPTZ;

-- delivery_status values: NULL (not tracked), 'pending', 'accepted', 'sent',
-- 'delivered', 'soft_bounce', 'hard_bounce', 'rejected', 'blacklisted', 'unknown'

CREATE INDEX IF NOT EXISTS idx_notification_queue_delivery_status
  ON notification_queue (delivery_status, sent_at)
  WHERE channel = 'sms';

-- 2. Log de tous les events Brevo reçus (audit trail + idempotence)
CREATE TABLE IF NOT EXISTS brevo_sms_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      TEXT NOT NULL,
  event           VARCHAR(30) NOT NULL,
  recipient       VARCHAR(20),
  description     TEXT,
  error_code      VARCHAR(20),
  raw_payload     JSONB,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_brevo_sms_events_message_id
  ON brevo_sms_events (message_id);

CREATE INDEX IF NOT EXISTS idx_brevo_sms_events_received_at
  ON brevo_sms_events (received_at DESC);

-- Idempotence: même messageId + même event = ne traiter qu'une fois
CREATE UNIQUE INDEX IF NOT EXISTS idx_brevo_sms_events_unique
  ON brevo_sms_events (message_id, event);

-- 3. Blacklist phone — numéros pour lesquels Brevo a renvoyé hardBounce/blacklisted
-- Évite de re-tenter et de brûler des crédits
CREATE TABLE IF NOT EXISTS sms_blacklist (
  phone           VARCHAR(20) PRIMARY KEY,
  reason          VARCHAR(50) NOT NULL,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  occurrences     INT NOT NULL DEFAULT 1
);

-- 4. Webhook config storage (pour savoir quel webhook ID Brevo a créé pour chaque salon)
CREATE TABLE IF NOT EXISTS brevo_webhooks (
  salon_id        VARCHAR(32) PRIMARY KEY REFERENCES salons(id),
  webhook_id      INT NOT NULL,
  webhook_url     TEXT NOT NULL,
  events          TEXT[] NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
