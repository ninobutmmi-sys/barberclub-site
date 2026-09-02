-- ============================================
-- 078 — Journal des evenements email de Brevo
-- ============================================
-- Le canal SMS a son webhook depuis avril : on sait, message par message, s'il
-- est arrive, s'il a rebondi, si l'operateur l'a refuse. L'email n'a rien. Sur
-- les 780 courriels partis en sept jours, zero retour : la file les marque
-- « envoyes » parce que Brevo a repondu 201, et la suite se passe hors de notre
-- vue. Quand un client dit ne pas avoir recu sa confirmation, il n'y a rien a
-- regarder.
--
-- Cette table recoit les evenements du webhook email, comme brevo_sms_events
-- pour les SMS.
CREATE TABLE IF NOT EXISTS brevo_email_events (
  id            BIGSERIAL PRIMARY KEY,
  message_id    TEXT NOT NULL,
  event         TEXT NOT NULL,
  recipient     TEXT,
  subject       TEXT,
  reason        TEXT,
  raw_payload   JSONB,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Brevo rejoue ses evenements : le meme couple message + evenement ne doit
-- etre enregistre qu'une fois.
CREATE UNIQUE INDEX IF NOT EXISTS brevo_email_events_unique
  ON brevo_email_events (message_id, event);

CREATE INDEX IF NOT EXISTS brevo_email_events_recent
  ON brevo_email_events (received_at DESC);

CREATE INDEX IF NOT EXISTS brevo_email_events_recipient
  ON brevo_email_events (lower(recipient));
