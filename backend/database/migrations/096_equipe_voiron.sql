-- ============================================
-- Migration 096 : l'équipe de Voiron
--
-- Voiron ouvrira avec quatre barbiers :
--   - Clément, responsable, à temps plein. Il quitte Grenoble à l'ouverture.
--     On lui crée un profil propre à Voiron : les prestations sont propres à
--     chaque salon, et son profil de Grenoble garde son historique et ses
--     stats. Ce profil-là n'est PAS touché ici ; il recevra un contract_end le
--     jour où la date d'ouverture sera fixée.
--   - Gabriel, apprenti. Créé sous le nom « Gab » (075), contrat au 15
--     octobre. Ses jours d'école se saisissent comme pour les autres
--     apprentis (blocked_slots type 'school').
--   - Jules, nouveau.
--   - Julien, un jour par semaine en plus de Meylan et Grenoble. Profil
--     Voiron à part entière, comme à Grenoble (092) plutôt qu'en invité : en
--     invité, un créneau pris dans un salon bloquait l'autre. Hors du « peu
--     importe » : on vient le voir, lui.
--
-- Date d'ouverture et horaires pas encore connus : toute la semaine type est
-- en repos, personne n'est réservable. Les horaires se saisissent ensuite
-- (dashboard ou migration) ; pour Julien, il suffira d'ouvrir son jour.
--
-- Les comptes ne servent pas à se connecter (gestion via le compte admin
-- Voiron) : mot de passe = UUID, qui n'est pas un hash bcrypt valide.
-- Idempotent.
-- ============================================

-- 1. Gab devient Gabriel
UPDATE barbers SET name = 'Gabriel'
WHERE id = 'f1fa01de-9af5-4296-914c-dca33fc2dfe2' AND name = 'Gab';

-- 2. Clément : sa photo et son rôle repris de son profil de Grenoble
INSERT INTO barbers (id, name, role, photo_url, email, password_hash, is_active, sort_order, salon_id)
SELECT '89670916-8e19-49d6-b80b-e3ba695dead4', 'Clément', c.role, c.photo_url,
       'clement@barberclub-voiron.fr', gen_random_uuid()::text, true, 0, 'voiron'
FROM barbers c
WHERE c.id = 'b1000000-0000-0000-0000-000000000004'
ON CONFLICT (id) DO NOTHING;

-- 3. Jules
INSERT INTO barbers (id, name, role, email, password_hash, is_active, sort_order, salon_id)
VALUES ('e4b7e90e-83be-4ed4-b3fc-e52d1b3eec6d', 'Jules', 'Barber',
        'jules@barberclub-voiron.fr', gen_random_uuid()::text, true,
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM barbers WHERE salon_id = 'voiron' AND deleted_at IS NULL),
        'voiron')
ON CONFLICT (id) DO NOTHING;

-- 4. Julien : photo et rôle repris de son profil de Meylan
INSERT INTO barbers (id, name, role, photo_url, email, password_hash, is_active,
                     exclude_from_any, sort_order, salon_id)
SELECT 'b5000000-0000-0000-0000-000000000001', 'Julien', j.role, j.photo_url,
       'julien-voiron@barberclub-voiron.fr', gen_random_uuid()::text, true,
       true,
       (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM barbers WHERE salon_id = 'voiron' AND deleted_at IS NULL),
       'voiron'
FROM barbers j
WHERE j.salon_id = 'meylan' AND j.name ILIKE 'julien%' AND j.deleted_at IS NULL
ORDER BY j.created_at
LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- 5. Semaine type : tout en repos (0 = lundi … 6 = dimanche)
INSERT INTO schedules (barber_id, day_of_week, start_time, end_time, is_working, salon_id)
SELECT b.id, d, '09:00'::time, '19:00'::time, false, 'voiron'
FROM barbers b
CROSS JOIN generate_series(0, 6) AS d
WHERE b.id IN ('89670916-8e19-49d6-b80b-e3ba695dead4',
               'e4b7e90e-83be-4ed4-b3fc-e52d1b3eec6d',
               'b5000000-0000-0000-0000-000000000001')
ON CONFLICT (barber_id, day_of_week) DO NOTHING;

-- 6. Prestations : tout le catalogue de Voiron
INSERT INTO barber_services (barber_id, service_id)
SELECT b.id, s.id
FROM barbers b
JOIN services s ON s.salon_id = 'voiron' AND s.is_active = true AND s.deleted_at IS NULL
WHERE b.id IN ('89670916-8e19-49d6-b80b-e3ba695dead4',
               'e4b7e90e-83be-4ed4-b3fc-e52d1b3eec6d',
               'b5000000-0000-0000-0000-000000000001')
ON CONFLICT (barber_id, service_id) DO NOTHING;
