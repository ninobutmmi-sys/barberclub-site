-- ============================================
-- Migration 018: Seed data for Grenoble salon
-- Barbers, services, schedules, automation triggers
-- Run AFTER 017_multi_salon.sql
-- ============================================

-- ============================================
-- ADMIN ACCOUNT (dashboard login)
-- Password: "Barberclot1968@@"
-- ============================================
INSERT INTO barbers (id, name, role, photo_url, email, password_hash, is_active, sort_order, salon_id) VALUES
(
    'b2000000-0000-0000-0000-000000000001',
    'Admin',
    'Admin',
    '/barbers/julien.jpg',
    'barberclotbey@gmail.com',
    '$2b$12$vq79qE1ejRAagS3mWru/6.dn9dOJRiPb1c0Yi.z0LQISqTraqVpVu',
    false,
    0,
    'grenoble'
);

-- ============================================
-- BARBERS (4)
-- No dashboard login — managed via Admin account
-- ============================================
INSERT INTO barbers (id, name, role, photo_url, email, password_hash, is_active, sort_order, salon_id) VALUES
(
    'b1000000-0000-0000-0000-000000000001',
    'Tom',
    'Barber',
    '/barbers/tom.png',
    'tom.barber@barberclub-grenoble.fr',
    '$2b$12$jU/8su0A//PmOQn1X.zVnelJwdT.GOHd3atetPPyurk8tciqozAki',
    true,
    1,
    'grenoble'
),
(
    'b1000000-0000-0000-0000-000000000002',
    'Alan',
    'Barber',
    '/barbers/alan.png',
    'alan@barberclub-grenoble.fr',
    '$2b$12$jU/8su0A//PmOQn1X.zVnelJwdT.GOHd3atetPPyurk8tciqozAki',
    true,
    2,
    'grenoble'
),
(
    'b1000000-0000-0000-0000-000000000003',
    'Nathan',
    'Barber',
    '/barbers/nathan.png',
    'nathan@barberclub-grenoble.fr',
    '$2b$12$jU/8su0A//PmOQn1X.zVnelJwdT.GOHd3atetPPyurk8tciqozAki',
    true,
    3,
    'grenoble'
),
(
    'b1000000-0000-0000-0000-000000000004',
    E'Cl\u00e9ment',
    'Barber',
    '/barbers/clement.png',
    'clement@barberclub-grenoble.fr',
    '$2b$12$jU/8su0A//PmOQn1X.zVnelJwdT.GOHd3atetPPyurk8tciqozAki',
    true,
    4,
    'grenoble'
);

-- ============================================
-- SERVICES (8)
-- Prices in centimes (2500 = 25,00 EUR)
-- ============================================
INSERT INTO services (id, name, price, duration, is_active, sort_order, color, salon_id) VALUES
('a1000000-0000-0000-0000-000000000001', 'Coupe Homme sans barbe',          2000, 30, true,  1, '#22c55e', 'grenoble'),
('a1000000-0000-0000-0000-000000000002', 'Coupe + Contours Barbe',          2500, 30, true,  2, '#3b82f6', 'grenoble'),
('a1000000-0000-0000-0000-000000000003', 'Barbe uniquement',                1500, 20, true,  3, '#ef4444', 'grenoble'),
('a1000000-0000-0000-0000-000000000004', 'Coupe Enfant (-12 ans)',          1500, 20, true,  4, '#f97316', 'grenoble'),
('a1000000-0000-0000-0000-000000000005', 'Coupe Etudiante',                 1500, 20, true,  5, '#f59e0b', 'grenoble'),
('a1000000-0000-0000-0000-000000000006', 'Coupe + Barbe',                   3000, 30, true,  6, '#14b8a6', 'grenoble'),
('a1000000-0000-0000-0000-000000000007', 'Coupe Homme sans barbe (20min)',  2000, 20, true,  7, '#8b5cf6', 'grenoble'),
('a1000000-0000-0000-0000-000000000008', E'M\u00e8ches',                    4000, 30, false, 8, '#d946ef', 'grenoble');

-- ============================================
-- BARBER <-> SERVICE assignments
-- Tom, Alan, Nathan: all except Meches and "Coupe Homme sans barbe (20min)"
-- Clement: all except Meches, no "Coupe Homme sans barbe" 30min, gets "Coupe Homme sans barbe (20min)" instead
-- ============================================
INSERT INTO barber_services (barber_id, service_id) VALUES
-- Tom: services 1-6 (no Meches, no Coupe Homme 20min)
('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001'),
('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002'),
('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003'),
('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004'),
('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005'),
('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000006'),
-- Alan: services 1-6 (no Meches, no Coupe Homme 20min)
('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001'),
('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002'),
('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003'),
('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000004'),
('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000005'),
('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000006'),
-- Nathan: services 1-6 (no Meches, no Coupe Homme 20min)
('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001'),
('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002'),
('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003'),
('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000004'),
('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000005'),
('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000006'),
-- Clement: services 2-7 (no Meches, no "Coupe Homme" 30min, gets "Coupe Homme 20min" instead)
('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002'),
('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000003'),
('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000004'),
('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000005'),
('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000006'),
('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000007');

-- ============================================
-- SCHEDULES
-- day_of_week: 0=Lundi, 1=Mardi, 2=Mercredi, 3=Jeudi, 4=Vendredi, 5=Samedi, 6=Dimanche
-- All barbers: 10:00-19:00
-- Everyone off Dimanche (6)
-- Clement also off Lundi (0)
-- ============================================
INSERT INTO schedules (barber_id, day_of_week, start_time, end_time, is_working, salon_id) VALUES
-- Tom: works Lundi-Samedi, off Dimanche
('b1000000-0000-0000-0000-000000000001', 0, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000001', 1, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000001', 2, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000001', 3, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000001', 4, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000001', 5, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000001', 6, '10:00', '19:00', false, 'grenoble'),
-- Alan: works Lundi-Samedi, off Dimanche
('b1000000-0000-0000-0000-000000000002', 0, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000002', 1, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000002', 2, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000002', 3, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000002', 4, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000002', 5, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000002', 6, '10:00', '19:00', false, 'grenoble'),
-- Nathan: works Lundi-Samedi, off Dimanche
('b1000000-0000-0000-0000-000000000003', 0, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000003', 1, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000003', 2, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000003', 3, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000003', 4, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000003', 5, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000003', 6, '10:00', '19:00', false, 'grenoble'),
-- Clement: off Lundi AND Dimanche, works Mardi-Samedi
('b1000000-0000-0000-0000-000000000004', 0, '10:00', '19:00', false, 'grenoble'),
('b1000000-0000-0000-0000-000000000004', 1, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000004', 2, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000004', 3, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000004', 4, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000004', 5, '10:00', '19:00', true,  'grenoble'),
('b1000000-0000-0000-0000-000000000004', 6, '10:00', '19:00', false, 'grenoble');

-- ============================================
-- AUTOMATION TRIGGERS (Grenoble)
-- Same 3 types as Meylan, with grenoble salon_id
-- ============================================
INSERT INTO automation_triggers (type, is_active, config, salon_id) VALUES
(
    'review_sms',
    true,
    '{"delay_minutes": 60, "message": "Merci pour ta visite {prenom} ! Laisse-nous un avis : {lien_avis}", "google_review_url": "https://g.page/r/CQITc4NCTyzhEAE/review"}',
    'grenoble'
),
(
    'reactivation_sms',
    true,
    '{"inactive_days": 45, "message": "Salut {prenom}, ca fait un moment ! Ton barber t''attend chez BarberClub Grenoble. Reserve vite : {lien_reservation}"}',
    'grenoble'
),
(
    'waitlist_notify',
    true,
    '{"message": "Bonne nouvelle {prenom} ! Une place s''est liberee chez {barbier} pour {prestation} chez BarberClub Grenoble. Reserve vite : {lien_reservation}"}',
    'grenoble'
);
