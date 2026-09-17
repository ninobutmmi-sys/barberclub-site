-- ============================================
-- Migration 092 : Julien a un vrai profil à Grenoble
--
-- Il y venait en invité : une règle hebdomadaire (guest_weekly) générait des
-- jours invités sur son profil de Meylan. Deux défauts sur le terrain :
--   1. ses RDV de Meylan et de Grenoble vivaient sur le même barbier, donc un
--      jeudi déjà pris à Meylan bloquait la récurrence à Grenoble — « les
--      créneaux sont déjà pris », sans dire lequel ni où ;
--   2. il fallait passer par « Autre salon », alors que l'équipe veut un
--      profil qu'on active et désactive comme les autres.
--
-- Il devient donc un barbier de Grenoble à part entière : jeudi 10h-19h, repos
-- le reste de la semaine, ses cinq prestations « avec Ju », sa photo. Son
-- profil de Meylan garde son histoire ; son jeudi y passe en repos.
-- Il reste hors du « peu importe » : on vient le voir, lui.
--
-- Le compte ne sert pas à se connecter : le mot de passe est un UUID, qui
-- n'est pas un hash bcrypt valide, donc aucune comparaison ne peut réussir.
-- ============================================

INSERT INTO barbers (id, name, role, photo_url, email, password_hash, is_active,
                     exclude_from_any, sort_order, salon_id)
SELECT 'b4000000-0000-0000-0000-000000000001', 'Julien', j.role, j.photo_url,
       'julien-grenoble@barberclub-grenoble.fr', gen_random_uuid()::text, true,
       true,
       (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM barbers WHERE salon_id = 'grenoble' AND deleted_at IS NULL),
       'grenoble'
FROM barbers j
WHERE j.salon_id = 'meylan' AND j.name ILIKE 'julien%' AND j.deleted_at IS NULL
ON CONFLICT (id) DO NOTHING;

-- Semaine type : le jeudi (3), rien d'autre.
INSERT INTO schedules (barber_id, day_of_week, start_time, end_time, is_working, salon_id)
SELECT 'b4000000-0000-0000-0000-000000000001', d,
       CASE WHEN d = 3 THEN '10:00'::time ELSE '09:00'::time END,
       '19:00'::time,
       d = 3,
       'grenoble'
FROM generate_series(0, 6) AS d
ON CONFLICT (barber_id, day_of_week) DO UPDATE
  SET start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      is_working = EXCLUDED.is_working,
      salon_id = EXCLUDED.salon_id;

-- Ses prestations de Grenoble changent de main, prix et durées compris.
INSERT INTO barber_services (barber_id, service_id, custom_duration, custom_price)
SELECT 'b4000000-0000-0000-0000-000000000001', bs.service_id, bs.custom_duration, bs.custom_price
FROM barber_services bs
JOIN services s ON s.id = bs.service_id
JOIN barbers j ON j.id = bs.barber_id
WHERE s.salon_id = 'grenoble' AND s.deleted_at IS NULL
  AND j.salon_id = 'meylan' AND j.name ILIKE 'julien%' AND j.deleted_at IS NULL
ON CONFLICT (barber_id, service_id) DO UPDATE
  SET custom_duration = EXCLUDED.custom_duration, custom_price = EXCLUDED.custom_price;

DELETE FROM barber_services bs
USING services s, barbers j
WHERE bs.service_id = s.id AND bs.barber_id = j.id
  AND s.salon_id = 'grenoble'
  AND j.salon_id = 'meylan' AND j.name ILIKE 'julien%' AND j.deleted_at IS NULL;

-- Ses RDV de Grenoble suivent le profil, sinon ils n'apparaîtraient plus dans
-- aucun planning (la vue est filtrée par salon).
UPDATE bookings b
SET barber_id = 'b4000000-0000-0000-0000-000000000001'
FROM barbers j
WHERE b.barber_id = j.id AND b.salon_id = 'grenoble'
  AND j.salon_id = 'meylan' AND j.name ILIKE 'julien%' AND j.deleted_at IS NULL;

-- Fin de l'invitation : la règle et les jours générés disparaissent.
DELETE FROM guest_weekly gw
USING barbers j
WHERE gw.barber_id = j.id AND gw.host_salon_id = 'grenoble'
  AND j.salon_id = 'meylan' AND j.name ILIKE 'julien%' AND j.deleted_at IS NULL;

DELETE FROM guest_assignments ga
USING barbers j
WHERE ga.barber_id = j.id AND ga.host_salon_id = 'grenoble'
  AND j.salon_id = 'meylan' AND j.name ILIKE 'julien%' AND j.deleted_at IS NULL;

-- À Meylan, son jeudi devient un repos : il coupe à Grenoble ce jour-là.
UPDATE schedules s
SET is_working = false
FROM barbers j
WHERE s.barber_id = j.id AND s.salon_id = 'meylan' AND s.day_of_week = 3
  AND j.salon_id = 'meylan' AND j.name ILIKE 'julien%' AND j.deleted_at IS NULL;
