-- Migration 055: Ajout de Benj — barber en CDD à Meylan (15 juin → 31 juillet 2026)
-- 27h/semaine : lundi, vendredi, samedi — 9h-12h / 13h-19h (créneau 9h-19h, pause 12h-13h).
-- Pas d'email perso : compte non utilisé pour se connecter (gestion via le compte admin
-- Meylan partagé). Email placeholder + hash bcrypt d'un mot de passe aléatoire jeté.
-- Idempotent : ON CONFLICT sur l'email / les clés.

-- 1. Le barber
INSERT INTO barbers (id, name, role, email, password_hash, is_active, salon_id, sort_order, contract_start, contract_end)
VALUES (
  '985ae398-39ab-414e-9c91-4afe829b24a6',
  'Benj',
  'Barber',
  'benj.cdd@barberclub-grenoble.fr',
  '$2b$12$8lSUWXzAxK6QosGtZG3XMOzPVgvDr1XPpubBU6ebEAukNSHBakXye',
  true,
  'meylan',
  (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM barbers WHERE salon_id = 'meylan'),
  '2026-06-15',
  '2026-07-31'
)
ON CONFLICT (id) DO UPDATE SET
  contract_start = EXCLUDED.contract_start,
  contract_end   = EXCLUDED.contract_end,
  is_active      = EXCLUDED.is_active;

-- 2. Horaires hebdo (0=Lundi … 6=Dimanche)
--    Travaille : lundi (0), vendredi (4), samedi (5) — 9h-19h, pause 12h-13h.
--    Autres jours : is_working = false (start/end NOT NULL → valeurs neutres).
INSERT INTO schedules (barber_id, day_of_week, start_time, end_time, is_working, salon_id, break_start, break_end)
VALUES
  ('985ae398-39ab-414e-9c91-4afe829b24a6', 0, '09:00', '19:00', true,  'meylan', '12:00', '13:00'),
  ('985ae398-39ab-414e-9c91-4afe829b24a6', 1, '09:00', '19:00', false, 'meylan', NULL,    NULL),
  ('985ae398-39ab-414e-9c91-4afe829b24a6', 2, '09:00', '19:00', false, 'meylan', NULL,    NULL),
  ('985ae398-39ab-414e-9c91-4afe829b24a6', 3, '09:00', '19:00', false, 'meylan', NULL,    NULL),
  ('985ae398-39ab-414e-9c91-4afe829b24a6', 4, '09:00', '19:00', true,  'meylan', '12:00', '13:00'),
  ('985ae398-39ab-414e-9c91-4afe829b24a6', 5, '09:00', '19:00', true,  'meylan', '12:00', '13:00'),
  ('985ae398-39ab-414e-9c91-4afe829b24a6', 6, '09:00', '19:00', false, 'meylan', NULL,    NULL)
ON CONFLICT (barber_id, day_of_week) DO UPDATE SET
  start_time = EXCLUDED.start_time,
  end_time   = EXCLUDED.end_time,
  is_working = EXCLUDED.is_working,
  break_start = EXCLUDED.break_start,
  break_end   = EXCLUDED.break_end;

-- 3. Prestations : toutes les prestations actives de Meylan
INSERT INTO barber_services (barber_id, service_id)
SELECT '985ae398-39ab-414e-9c91-4afe829b24a6', id
FROM services
WHERE salon_id = 'meylan' AND is_active = true AND deleted_at IS NULL
ON CONFLICT (barber_id, service_id) DO NOTHING;
