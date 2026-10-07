-- ============================================
-- Migration 101 : partenariat WiiKard à Meylan
--
-- Une coupe homme au tarif étudiant (24 €, 30 min, 30 min le samedi),
-- réservable uniquement avec Alex : la prestation n'est rattachée qu'à lui
-- dans barber_services, donc « peu importe » tombe sur lui et l'étape barber
-- ne propose que lui. Le client présente sa carte WiiKard au salon.
-- Couleur du planning : le rouge WiiKard.
-- ============================================

INSERT INTO services (id, name, price, duration, duration_saturday, description, color, sort_order, salon_id, is_active, admin_only)
VALUES (
  'a0000000-0000-0000-0000-00000000a101',
  'Coupe Homme WiiKard',
  2400, 30, 30,
  'Shampooing, coupe, coiffage. Tarif partenaire sur présentation de votre carte WiiKard.',
  '#ff4136', 5, 'meylan', true, false
)
ON CONFLICT (id) DO NOTHING;

-- Alex seulement
INSERT INTO barber_services (barber_id, service_id)
VALUES ('32072b24-c3f7-4b03-9a6f-3a7f858d6e21', 'a0000000-0000-0000-0000-00000000a101')
ON CONFLICT DO NOTHING;
