-- ============================================
-- 076 — Un prix par barbier
-- ============================================
-- Daryl debute a Meylan : ses coupes sont offertes le temps de sa mise en
-- route. Jusqu'ici le prix vivait uniquement sur la prestation, commune a
-- toute l'equipe : le rendre gratuit pour lui seul demandait soit de dupliquer
-- les onze prestations, soit d'ecrire son nom en dur dans le code.
--
-- `barber_services` portait deja `custom_duration` pour la meme raison — un
-- barbier plus lent ou plus rapide sur une prestation. Le prix suit le meme
-- chemin : NULL = le prix de la prestation, une valeur = ce prix-la pour ce
-- barbier, zero compris.
ALTER TABLE barber_services
  ADD COLUMN IF NOT EXISTS custom_price INTEGER;

COMMENT ON COLUMN barber_services.custom_price IS
  'Prix en centimes pour ce barbier sur cette prestation. NULL = prix de la prestation. 0 = offert.';

-- Rejouable : la contrainte n'a pas de IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_services_custom_price_positif') THEN
    ALTER TABLE barber_services
      ADD CONSTRAINT barber_services_custom_price_positif
      CHECK (custom_price IS NULL OR custom_price >= 0);
  END IF;
END $$;
