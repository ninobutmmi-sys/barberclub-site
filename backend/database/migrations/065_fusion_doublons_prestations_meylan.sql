-- Migration 065: fusion des 5 prestations Meylan en doublon
--
-- Ces doublons datent d'avant barber_services.custom_duration (046) : pour donner
-- une durée différente à un barbier, on créait une seconde prestation de même nom
-- et même prix. D'où « Coupe Homme » en 30 ET en 40 min, etc. — 5 paires, 16
-- prestations actives à Meylan au lieu de 11.
--
-- Les prix sont IDENTIQUES dans chaque paire, seule la durée diffère : la durée
-- personnalisée par barbier suffit donc à les remplacer.
--
-- Trois des variantes 40 min n'ont déjà PLUS AUCUN barbier (Louay est passé en
-- custom_duration à la 056) : ce sont des orphelines, il ne reste que leur
-- historique. Les deux autres portent encore un barbier, qui récupère une durée
-- personnalisée sur la prestation conservée.
--
--   SUPPRIMÉE                          CONSERVÉE                  BARBIER REPRIS
--   Coupe Homme 40 (62363041…)         Coupe Homme 30 (…0001)     — (orpheline)
--   Coupe + Barbe 40 (4c7d1024…)       …0003                      — (orpheline)
--   Coupe + Contours 40 (dfd36829…)    …0002                      — (orpheline)
--   Coupe Enfant 30 (5b14f48c…)        Coupe Enfant 20 (…0012)    Benji  -> 30
--   Coupe Études 20 (…0005)            Coupe Études 30 (…0004)    Julien -> 20
--
-- On conserve dans chaque paire la prestation la plus utilisée (plus de barbiers
-- et plus de RDV). Suppression logique (deleted_at + is_active=false) et non
-- physique : réversible, et aucune contrainte à contourner.
--
-- Sans effet sur l'historique affiché : bookings porte son propre price et son
-- propre end_time, et la prestation reprise a le MÊME NOM et le MÊME PRIX.
-- Sauvegarde préalable : ~/barberclub-backups/pre-fusion-prestations_*.sql.gz

-- ── 1. Les barbiers de la variante récupèrent leur durée sur la conservée ──
--    (INSERT plutôt qu'UPDATE : le lien peut ne pas exister encore.)
INSERT INTO barber_services (barber_id, service_id, custom_duration)
SELECT bs.barber_id, 'a0000000-0000-0000-0000-000000000012', 30      -- Coupe Enfant, Benji
FROM barber_services bs WHERE bs.service_id = '5b14f48c-dadb-40fa-8a4d-fb09a382f4df'
ON CONFLICT (barber_id, service_id) DO UPDATE SET custom_duration = 30;

INSERT INTO barber_services (barber_id, service_id, custom_duration)
SELECT bs.barber_id, 'a0000000-0000-0000-0000-000000000004', 20      -- Coupe Études, Julien
FROM barber_services bs WHERE bs.service_id = 'a0000000-0000-0000-0000-000000000005'
ON CONFLICT (barber_id, service_id) DO UPDATE SET custom_duration = 20;

-- ── 2. Repointage de l'historique et des listes d'attente ──
UPDATE bookings SET service_id = 'a0000000-0000-0000-0000-000000000001' WHERE service_id = '62363041-83d9-4972-b2cb-345892e96804';
UPDATE bookings SET service_id = 'a0000000-0000-0000-0000-000000000003' WHERE service_id = '4c7d1024-b4c6-40d3-9f93-4824be7f9f5f';
UPDATE bookings SET service_id = 'a0000000-0000-0000-0000-000000000002' WHERE service_id = 'dfd36829-8b2b-451a-88ba-e7063828cfc2';
UPDATE bookings SET service_id = 'a0000000-0000-0000-0000-000000000012' WHERE service_id = '5b14f48c-dadb-40fa-8a4d-fb09a382f4df';
UPDATE bookings SET service_id = 'a0000000-0000-0000-0000-000000000004' WHERE service_id = 'a0000000-0000-0000-0000-000000000005';

UPDATE waitlist SET service_id = 'a0000000-0000-0000-0000-000000000001' WHERE service_id = '62363041-83d9-4972-b2cb-345892e96804';
UPDATE waitlist SET service_id = 'a0000000-0000-0000-0000-000000000003' WHERE service_id = '4c7d1024-b4c6-40d3-9f93-4824be7f9f5f';
UPDATE waitlist SET service_id = 'a0000000-0000-0000-0000-000000000002' WHERE service_id = 'dfd36829-8b2b-451a-88ba-e7063828cfc2';
UPDATE waitlist SET service_id = 'a0000000-0000-0000-0000-000000000012' WHERE service_id = '5b14f48c-dadb-40fa-8a4d-fb09a382f4df';
UPDATE waitlist SET service_id = 'a0000000-0000-0000-0000-000000000004' WHERE service_id = 'a0000000-0000-0000-0000-000000000005';

-- ── 3. Les variantes sortent du catalogue ──
UPDATE services
SET deleted_at = NOW(), is_active = false
WHERE id IN (
  '62363041-83d9-4972-b2cb-345892e96804',
  '4c7d1024-b4c6-40d3-9f93-4824be7f9f5f',
  'dfd36829-8b2b-451a-88ba-e7063828cfc2',
  '5b14f48c-dadb-40fa-8a4d-fb09a382f4df',
  'a0000000-0000-0000-0000-000000000005'
);

DELETE FROM barber_services WHERE service_id IN (
  '62363041-83d9-4972-b2cb-345892e96804',
  '4c7d1024-b4c6-40d3-9f93-4824be7f9f5f',
  'dfd36829-8b2b-451a-88ba-e7063828cfc2',
  '5b14f48c-dadb-40fa-8a4d-fb09a382f4df',
  'a0000000-0000-0000-0000-000000000005'
);
