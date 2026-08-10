-- Migration 061: Ajout d'Alexandre — barber à Meylan, arrivée le lundi 17 août 2026
--
-- Horaires (0=Lundi … 6=Dimanche) :
--   Lundi     10h-19h, pause 13h-14h
--   Mercredi  09h-19h, pause 13h-14h
--   Vendredi  09h-19h, pause 13h-14h
--   Samedi    09h-19h, pause 13h-14h
--   Mardi / Jeudi / Dimanche : repos
--
-- contract_start = 2026-08-17 → availability.js ne propose aucun créneau avant
-- cette date (getSlotsForBarber + validateBarberSlot + dispo mensuelle).
-- contract_end = NULL → poste permanent, aucune borne de fin.
--
-- Pas d'email perso : compte non utilisé pour se connecter (gestion via le compte
-- admin Meylan partagé). Email placeholder + hash bcrypt d'un mot de passe
-- aléatoire jeté, même convention que Benj (055).
--
-- Idempotent : ON CONFLICT sur les clés.

-- 1. Le barber
INSERT INTO barbers (id, name, role, email, password_hash, is_active, salon_id, sort_order, contract_start, contract_end)
VALUES (
  '32072b24-c3f7-4b03-9a6f-3a7f858d6e21',
  'Alexandre',
  'Barber',
  'alexandre@barberclub-meylan.fr',
  '$2b$12$mBoiSKf6R5No4NPKpZWrKeJgLGs/4U3lNMA0Y3FttveSnAQFsH8sa',
  true,
  'meylan',
  (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM barbers WHERE salon_id = 'meylan'),
  '2026-08-17',
  NULL
)
ON CONFLICT (id) DO UPDATE SET
  name           = EXCLUDED.name,
  contract_start = EXCLUDED.contract_start,
  contract_end   = EXCLUDED.contract_end,
  is_active      = EXCLUDED.is_active;

-- 2. Horaires hebdo
INSERT INTO schedules (barber_id, day_of_week, start_time, end_time, is_working, salon_id, break_start, break_end)
VALUES
  ('32072b24-c3f7-4b03-9a6f-3a7f858d6e21', 0, '10:00', '19:00', true,  'meylan', '13:00', '14:00'), -- Lundi
  ('32072b24-c3f7-4b03-9a6f-3a7f858d6e21', 1, '09:00', '19:00', false, 'meylan', NULL,    NULL),    -- Mardi (repos)
  ('32072b24-c3f7-4b03-9a6f-3a7f858d6e21', 2, '09:00', '19:00', true,  'meylan', '13:00', '14:00'), -- Mercredi
  ('32072b24-c3f7-4b03-9a6f-3a7f858d6e21', 3, '09:00', '19:00', false, 'meylan', NULL,    NULL),    -- Jeudi (repos)
  ('32072b24-c3f7-4b03-9a6f-3a7f858d6e21', 4, '09:00', '19:00', true,  'meylan', '13:00', '14:00'), -- Vendredi
  ('32072b24-c3f7-4b03-9a6f-3a7f858d6e21', 5, '09:00', '19:00', true,  'meylan', '13:00', '14:00'), -- Samedi
  ('32072b24-c3f7-4b03-9a6f-3a7f858d6e21', 6, '09:00', '19:00', false, 'meylan', NULL,    NULL)     -- Dimanche (repos)
ON CONFLICT (barber_id, day_of_week) DO UPDATE SET
  start_time  = EXCLUDED.start_time,
  end_time    = EXCLUDED.end_time,
  is_working  = EXCLUDED.is_working,
  break_start = EXCLUDED.break_start,
  break_end   = EXCLUDED.break_end;

-- 3. Prestations — on recopie exactement le set de Nathan (barber Meylan standard).
--    Volontairement PAS "toutes les prestations actives de Meylan" : le catalogue
--    contient des doublons de durée réservés à LOUAY (Coupe Homme 40 min, etc.) et
--    une variante 20 min propre à Julien. Les reprendre afficherait des prestations
--    en double dans la réservation.
--    (UUID en dur : il existe aussi un Nathan à Grenoble.)
INSERT INTO barber_services (barber_id, service_id)
SELECT '32072b24-c3f7-4b03-9a6f-3a7f858d6e21', bs.service_id
FROM barber_services bs
WHERE bs.barber_id = '2341e180-a239-4851-8f97-a88b7557c249' -- Nathan (Meylan)
ON CONFLICT (barber_id, service_id) DO NOTHING;
