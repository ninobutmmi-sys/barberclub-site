-- Migration 052: Louay en guest à Meylan (samedi) — services et durées custom
-- Louay (5873336f-8ed4-4be5-baf1-1e1877df116f) travaille le samedi à Meylan
-- Quand il est à Meylan, il propose les services Meylan (prix Meylan) avec
-- des durées spécifiques pour lui : coupes 30 min, barbes 40 min.
--
-- Dépend du changement bookings.js qui fait basculer un guest barber vers les
-- services du salon hôte dès qu'il y a au moins un barber_services dans ce salon.

INSERT INTO barber_services (barber_id, service_id, custom_duration) VALUES
  -- Coupe Homme (défaut 30 min) → 30 min, pas de custom_duration
  ('5873336f-8ed4-4be5-baf1-1e1877df116f', 'a0000000-0000-0000-0000-000000000001', NULL),
  -- Coupe Homme + Contours de Barbe (défaut 30 min) → 40 min
  ('5873336f-8ed4-4be5-baf1-1e1877df116f', 'a0000000-0000-0000-0000-000000000002', 40),
  -- Coupe Homme + Barbe (défaut 30 min) → 40 min
  ('5873336f-8ed4-4be5-baf1-1e1877df116f', 'a0000000-0000-0000-0000-000000000003', 40),
  -- Coupe Études Sup / Collège / Lycée (1) (défaut 30 min) → 30 min, pas de custom_duration
  ('5873336f-8ed4-4be5-baf1-1e1877df116f', 'a0000000-0000-0000-0000-000000000004', NULL),
  -- Coupe Enfant -12 ans (défaut 20 min) → 30 min
  ('5873336f-8ed4-4be5-baf1-1e1877df116f', 'a0000000-0000-0000-0000-000000000012', 30)
ON CONFLICT (barber_id, service_id) DO UPDATE SET custom_duration = EXCLUDED.custom_duration;
