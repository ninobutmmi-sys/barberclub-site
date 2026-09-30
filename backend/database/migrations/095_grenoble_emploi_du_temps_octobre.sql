-- ============================================
-- Migration 095 : emploi du temps de Grenoble à partir du lundi 5 octobre
--
-- Tableau de Ju « du 01/10 au 17/10 avec Durell et Clem ». Le reste de
-- l'équipe y figure déjà en base ; seuls ces points changent :
--   - Eddine passe le lundi (10h-12h30 / 14h30-19h) et ne travaille plus le samedi.
--   - Durel : son après-midi du lundi (14h-19h) passe au mercredi, lundi école.
--   - Alan le jeudi et Louay le samedi : jours de repos, qu'on rouvre au besoin
--     depuis le planning (bouton « Ouvrir »). Leur pause 13h-14h reste
--     enregistrée pour s'appliquer quand on les rouvre. Le samedi de Louay
--     tenait jusqu'ici par un bloc 9h-19h posé date par date, jusqu'au 5
--     décembre seulement ; les blocs restent, le bouton propose de les retirer.
--   - Clément : pause 13h-14h le mardi et le vendredi, comme sur le tableau.
--
-- Le changement vaut à partir de la semaine prochaine : cette semaine, Alan
-- garde son jeudi 1er octobre et Eddine son samedi 3, déjà réservés.
-- day_of_week 0 = lundi.
-- ============================================

-- Eddine : lundi comme ses autres jours, samedi en repos
UPDATE schedules
SET is_working = true, start_time = '10:00', end_time = '19:00',
    break_start = '12:30', break_end = '14:30'
WHERE barber_id = 'ae41c500-c77c-4390-92a7-6a1732a9d107' AND salon_id = 'grenoble' AND day_of_week = 0;

UPDATE schedules SET is_working = false
WHERE barber_id = 'ae41c500-c77c-4390-92a7-6a1732a9d107' AND salon_id = 'grenoble' AND day_of_week = 5;

-- Durel : lundi en repos (école), mercredi 14h-19h
UPDATE schedules SET is_working = false
WHERE barber_id = '6d00c36c-f1e9-47cb-936a-62419d144615' AND salon_id = 'grenoble' AND day_of_week = 0;

UPDATE schedules
SET is_working = true, start_time = '14:00', end_time = '19:00',
    break_start = NULL, break_end = NULL
WHERE barber_id = '6d00c36c-f1e9-47cb-936a-62419d144615' AND salon_id = 'grenoble' AND day_of_week = 2;

-- Ses lundis d'école ne couvraient que la matinée, l'après-midi étant travaillé
UPDATE blocked_slots SET end_time = '20:30'
WHERE barber_id = '6d00c36c-f1e9-47cb-936a-62419d144615' AND type = 'school'
  AND date >= '2026-10-05' AND EXTRACT(ISODOW FROM date) = 1 AND end_time = '14:00';

-- Alan le jeudi, Louay le samedi : repos déblocable
UPDATE schedules SET is_working = false
WHERE salon_id = 'grenoble' AND (
     (barber_id = 'b1000000-0000-0000-0000-000000000002' AND day_of_week = 3)
  OR (barber_id = '5873336f-8ed4-4be5-baf1-1e1877df116f' AND day_of_week = 5));

-- Clément : pause déjeuner mardi et vendredi
UPDATE schedules SET break_start = '13:00', break_end = '14:00'
WHERE barber_id = 'b1000000-0000-0000-0000-000000000004' AND salon_id = 'grenoble' AND day_of_week IN (1, 4);

-- Cette semaine reste à l'ancien planning
INSERT INTO schedule_overrides (barber_id, date, is_day_off, start_time, end_time, reason, salon_id)
VALUES
  ('b1000000-0000-0000-0000-000000000002', '2026-10-01', false, '09:00', '19:00', 'Ancien planning (jeudi travaillé)', 'grenoble'),
  ('ae41c500-c77c-4390-92a7-6a1732a9d107', '2026-10-03', false, '10:00', '19:00', 'Ancien planning (samedi travaillé)', 'grenoble')
ON CONFLICT (barber_id, date) DO NOTHING;
