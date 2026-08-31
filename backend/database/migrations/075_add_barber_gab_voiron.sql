-- Migration 075: Gab — premier barber de Voiron, contrat à partir du 15 octobre 2026
--
-- contract_start = 2026-10-15 → aucun créneau ni RDV possible avant cette date,
-- côté client comme côté dashboard (assertWithinContract, cf. availability.js).
-- contract_end = NULL → poste permanent.
--
-- Horaires PAS ENCORE CONNUS au moment de la création : les 7 jours sont posés
-- à is_working = false. Sans ces lignes, `schedules` vide laisserait la colonne
-- du planning ouverte une fois le 15/10 passé ; avec elles, Gab reste hors ligne
-- tant que Nino n'a pas saisi ses horaires depuis le dashboard (page Barbers).
--
-- Prestations : le catalogue Voiron complet (11 services, créés en 072). Salon
-- neuf, pas de doublons hérités comme à Meylan — à ajuster depuis le dashboard
-- si Gab ne fait pas tout.
--
-- Pas d'email perso : compte non utilisé pour se connecter (gestion via le compte
-- admin Voiron partagé). Email placeholder + hash bcrypt d'un mot de passe
-- aléatoire jeté, même convention que Benj (055) et Alexandre (061).
--
-- Idempotent : ON CONFLICT sur les clés.

-- 1. Le barber
INSERT INTO barbers (id, name, role, email, password_hash, is_active, salon_id, sort_order, contract_start, contract_end)
VALUES (
  'f1fa01de-9af5-4296-914c-dca33fc2dfe2',
  'Gab',
  'Barber',
  'gab@barberclub-voiron.fr',
  '$2b$12$2VZc3Vd37UyH2dzhNKaT1Ozkn3XdMbcNTNR6f.Bb83yL3W0tY6wpW',
  true,
  'voiron',
  (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM barbers WHERE salon_id = 'voiron'),
  '2026-10-15',
  NULL
)
ON CONFLICT (id) DO UPDATE SET
  name           = EXCLUDED.name,
  contract_start = EXCLUDED.contract_start,
  contract_end   = EXCLUDED.contract_end,
  is_active      = EXCLUDED.is_active;

-- 2. Horaires hebdo — tous à false en attendant les vrais horaires (0=Lundi … 6=Dimanche)
INSERT INTO schedules (barber_id, day_of_week, start_time, end_time, is_working, salon_id, break_start, break_end)
VALUES
  ('f1fa01de-9af5-4296-914c-dca33fc2dfe2', 0, '09:00', '19:00', false, 'voiron', NULL, NULL),
  ('f1fa01de-9af5-4296-914c-dca33fc2dfe2', 1, '09:00', '19:00', false, 'voiron', NULL, NULL),
  ('f1fa01de-9af5-4296-914c-dca33fc2dfe2', 2, '09:00', '19:00', false, 'voiron', NULL, NULL),
  ('f1fa01de-9af5-4296-914c-dca33fc2dfe2', 3, '09:00', '19:00', false, 'voiron', NULL, NULL),
  ('f1fa01de-9af5-4296-914c-dca33fc2dfe2', 4, '09:00', '19:00', false, 'voiron', NULL, NULL),
  ('f1fa01de-9af5-4296-914c-dca33fc2dfe2', 5, '09:00', '19:00', false, 'voiron', NULL, NULL),
  ('f1fa01de-9af5-4296-914c-dca33fc2dfe2', 6, '09:00', '19:00', false, 'voiron', NULL, NULL)
ON CONFLICT (barber_id, day_of_week) DO NOTHING;

-- 3. Prestations — tout le catalogue actif de Voiron
INSERT INTO barber_services (barber_id, service_id)
SELECT 'f1fa01de-9af5-4296-914c-dca33fc2dfe2', s.id
FROM services s
WHERE s.salon_id = 'voiron' AND s.is_active = true AND s.deleted_at IS NULL
ON CONFLICT (barber_id, service_id) DO NOTHING;
