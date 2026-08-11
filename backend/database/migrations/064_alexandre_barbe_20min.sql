-- Migration 064: Barbe Uniquement d'Alexandre = 20 min (corrige la 063)
--
-- La 063 lui avait posé 30 min sur cette prestation. Nino la ramène à 20.
-- Comme 20 min est déjà la durée par défaut du service, on retire l'exception
-- au lieu d'y réécrire 20 : availability.js et booking.js ne lisent
-- custom_duration que s'il est NOT NULL, donc Alexandre repasse simplement sur
-- la durée standard et suivra la prestation si elle change un jour.
--
-- Ses quatre autres durées personnalisées ne bougent pas :
--   Coupe Homme + Barbe .............. 40 (défaut 30)
--   Coupe Enfant -12 ans ............. 30 (défaut 20)
--   Coupe Homme (CE) ................. 30 (défaut 20)
--   Coupe Homme + Contours (CE) ...... 30 (défaut 20)
--
-- Idempotent.

UPDATE barber_services
SET custom_duration = NULL
WHERE barber_id  = '32072b24-c3f7-4b03-9a6f-3a7f858d6e21'  -- Alexandre (Meylan)
  AND service_id = 'a0000000-0000-0000-0000-000000000007'; -- Barbe Uniquement (20,00 €)
