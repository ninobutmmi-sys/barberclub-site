-- ============================================
-- Migration 102 : partenariat WiiKard à Grenoble
--
-- Même principe qu'à Meylan (101) : une coupe homme au tarif étudiant de
-- Grenoble (15 €, 20 min), réservable uniquement avec Durel. Rattachée à lui
-- seul dans barber_services : la réservation saute l'étape barber.
-- Le client présente sa carte WiiKard au salon.
-- ============================================

INSERT INTO services (id, name, price, duration, description, color, sort_order, salon_id, is_active, admin_only)
VALUES (
  'a1000000-0000-0000-0000-00000000a102',
  'Coupe Homme WiiKard',
  1500, 20,
  'Shampooing, coupe, coiffage. Tarif partenaire sur présentation de votre carte WiiKard.',
  '#ff4136', 6, 'grenoble', true, false
)
ON CONFLICT (id) DO NOTHING;

-- Durel seulement
INSERT INTO barber_services (barber_id, service_id)
VALUES ('6d00c36c-f1e9-47cb-936a-62419d144615', 'a1000000-0000-0000-0000-00000000a102')
ON CONFLICT DO NOTHING;
