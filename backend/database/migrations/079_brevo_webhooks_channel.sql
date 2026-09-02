-- ============================================
-- 079 — Deux webhooks par salon : SMS et email
-- ============================================
-- La table ne gardait qu'une ligne par salon, avec le webhook SMS. Maintenant
-- qu'il y en a un second pour le courrier, la cle devient (salon, canal).
ALTER TABLE brevo_webhooks
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'sms';

ALTER TABLE brevo_webhooks DROP CONSTRAINT IF EXISTS brevo_webhooks_salon_id_key;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brevo_webhooks_salon_canal') THEN
    ALTER TABLE brevo_webhooks
      ADD CONSTRAINT brevo_webhooks_salon_canal UNIQUE (salon_id, channel);
  END IF;
END $$;
