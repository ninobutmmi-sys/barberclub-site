-- ============================================
-- Migration 103 : Grenoble, une seule « Coupe Homme »
--
-- Le client voyait deux fois la même coupe à 20 € : « Coupe Homme sans
-- barbe » (20 min, Clem et Ju) et « Coupe Homme » (30 min, le reste de
-- l'équipe). Depuis que la prestation se choisit avant le barbier, c'est une
-- seule case : Clem et Ju rejoignent « Coupe Homme » avec leur durée à eux
-- (custom_duration), et « Coupe Homme sans barbe » est désactivée.
--
-- Les RDV déjà pris gardent leur prestation d'origine (historique, planning,
-- caisse) : on ne les déplace pas.
--
-- Repérage par le nom, et arrêt net si on ne trouve pas exactement une
-- prestation de chaque côté : mieux vaut ne rien faire que fusionner à tort.
-- ============================================

DO $$
DECLARE
  cible  uuid;
  source uuid;
  n_cible  int;
  n_source int;
BEGIN
  SELECT count(*), min(id::text)::uuid INTO n_cible, cible
  FROM services
  WHERE salon_id = 'grenoble' AND name = 'Coupe Homme'
    AND is_active = true AND deleted_at IS NULL;

  SELECT count(*), min(id::text)::uuid INTO n_source, source
  FROM services
  WHERE salon_id = 'grenoble' AND name = 'Coupe Homme sans barbe'
    AND is_active = true AND deleted_at IS NULL;

  IF n_cible <> 1 OR n_source <> 1 THEN
    RAISE EXCEPTION 'Fusion annulée : % « Coupe Homme » et % « Coupe Homme sans barbe » actives à Grenoble (1 et 1 attendues)', n_cible, n_source;
  END IF;

  -- Les barbiers de « sans barbe » font la coupe homme, à leur durée
  -- (celle qu'ils avaient, sinon celle de la prestation : 20 min) et à leur prix.
  INSERT INTO barber_services (barber_id, service_id, custom_duration, custom_price)
  SELECT bs.barber_id, cible,
         COALESCE(bs.custom_duration, s.duration),
         bs.custom_price
  FROM barber_services bs
  JOIN services s ON s.id = bs.service_id
  WHERE bs.service_id = source
  ON CONFLICT (barber_id, service_id) DO UPDATE
    SET custom_duration = EXCLUDED.custom_duration,
        custom_price = COALESCE(EXCLUDED.custom_price, barber_services.custom_price);

  -- Leurs créneaux réservés à cette coupe, s'il y en a, suivent.
  INSERT INTO service_restrictions (service_id, barber_id, day_of_week, start_time, end_time, salon_id)
  SELECT cible, barber_id, day_of_week, start_time, end_time, salon_id
  FROM service_restrictions
  WHERE service_id = source
  ON CONFLICT (service_id, barber_id, day_of_week, salon_id) DO NOTHING;

  UPDATE services SET is_active = false WHERE id = source;

  RAISE NOTICE 'Fusion faite : % rejoint %', source, cible;
END $$;
