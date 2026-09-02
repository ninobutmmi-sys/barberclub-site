-- ============================================
-- 080 — Un numero plutot qu'une adresse
-- ============================================
-- La page de Voiron demandait un email pour prevenir de l'ouverture. Depuis le
-- 16 aout : une inscription. Un client qui passe devant les travaux sort son
-- telephone, il ne tape pas une adresse email — et le jour de l'ouverture, un
-- SMS se lit, un mail se perd (voir la remise email, aveugle jusqu'a hier).
--
-- La table accepte donc un numero, un prenom, et l'email devient facultatif.
ALTER TABLE event_alerts ALTER COLUMN email DROP NOT NULL;
ALTER TABLE event_alerts ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
ALTER TABLE event_alerts ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);

-- Au moins un moyen de joindre la personne, sinon la ligne ne sert a rien.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_alerts_un_contact') THEN
    ALTER TABLE event_alerts
      ADD CONSTRAINT event_alerts_un_contact
      CHECK (COALESCE(NULLIF(TRIM(email), ''), NULLIF(TRIM(phone), '')) IS NOT NULL);
  END IF;
END $$;

-- Deux personnes ne s'inscrivent pas deux fois avec le meme numero. L'index
-- est partiel : la contrainte UNIQUE existante ne couvre que l'email, et un
-- NULL n'entre jamais en conflit avec un autre NULL.
CREATE UNIQUE INDEX IF NOT EXISTS event_alerts_phone_unique
  ON event_alerts (phone, event_name, salon_id)
  WHERE phone IS NOT NULL;
