-- Migration 063: durées personnalisées d'Alexandre (Meylan)
--
-- Même carte que les autres barbiers de Meylan, seules certaines durées
-- diffèrent. On ne pose un custom_duration QUE là où la valeur demandée
-- s'écarte du défaut du service — ailleurs, laisser NULL fait suivre le
-- service si sa durée change un jour (cf. 062).
--
-- Demandé : enfant / étudiant / CE à 30 min, coupe + barbe à 40 min,
-- barbe uniquement à 30 min.
--
-- Déjà conformes, donc volontairement sans override :
--   Coupe Études Supérieures ......... défaut 30  (l'« étudiant » demandé)
--   Coupe Homme + Barbe (CE) ......... défaut 30
--   Coupe + Barbe (serviette chaude) . défaut 40
--
-- Alexandre = 32072b24-c3f7-4b03-9a6f-3a7f858d6e21. Idempotent.

UPDATE barber_services bs
SET custom_duration = v.duree
FROM (VALUES
  ('a0000000-0000-0000-0000-000000000012'::uuid, 30),  -- Coupe Enfant -12 ans        (défaut 20)
  ('a0000000-0000-0000-0000-000000000009'::uuid, 30),  -- Coupe Homme (CE)            (défaut 20)
  ('a0000000-0000-0000-0000-000000000010'::uuid, 30),  -- Coupe Homme + Contours (CE) (défaut 20)
  ('a0000000-0000-0000-0000-000000000007'::uuid, 30),  -- Barbe Uniquement            (défaut 20)
  ('a0000000-0000-0000-0000-000000000003'::uuid, 40)   -- Coupe Homme + Barbe         (défaut 30)
) AS v(service_id, duree)
WHERE bs.barber_id = '32072b24-c3f7-4b03-9a6f-3a7f858d6e21'
  AND bs.service_id = v.service_id;
