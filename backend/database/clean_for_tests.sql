-- ============================================
-- BarberClub — Nettoyage BDD pour tests
-- CONSERVE : barbers, services, barber_services, schedules, salons, automation_triggers
-- SUPPRIME : tout le reste (clients, bookings, notifications, etc.)
-- ============================================

BEGIN;

-- 1. Tables avec FK vers bookings
DELETE FROM notification_queue;
DELETE FROM campaign_clicks;

-- 2. Tables avec FK vers clients
DELETE FROM product_sales;
DELETE FROM gift_cards;
DELETE FROM waitlist;

-- 3. Bookings (FK vers clients, barbers, services)
DELETE FROM bookings;

-- 4. Client-salon pivot + clients
DELETE FROM client_salons;
DELETE FROM clients;

-- 5. Autres tables transactionnelles
DELETE FROM payments;
DELETE FROM register_closings;
DELETE FROM products;
DELETE FROM campaigns;
DELETE FROM blocked_slots;
DELETE FROM schedule_overrides;
DELETE FROM guest_assignments;
DELETE FROM refresh_tokens;
DELETE FROM audit_log;
DELETE FROM push_subscriptions;

-- 6. Reset review_sms delay a 2 min (temporaire pour tests)
UPDATE automation_triggers
SET config = jsonb_set(config, '{delay_minutes}', '2')
WHERE type = 'review_sms';

-- 7. Activer review_sms pour les 2 salons
UPDATE automation_triggers
SET is_active = true
WHERE type = 'review_sms';

COMMIT;

-- Verification
SELECT 'bookings' AS table_name, COUNT(*) FROM bookings
UNION ALL SELECT 'clients', COUNT(*) FROM clients
UNION ALL SELECT 'notification_queue', COUNT(*) FROM notification_queue
UNION ALL SELECT 'barbers', COUNT(*) FROM barbers
UNION ALL SELECT 'services', COUNT(*) FROM services
UNION ALL SELECT 'schedules', COUNT(*) FROM schedules
UNION ALL SELECT 'automation_triggers', COUNT(*) FROM automation_triggers;

-- Verifier le delay review_sms
SELECT type, salon_id, is_active, config->>'delay_minutes' AS delay_minutes
FROM automation_triggers
WHERE type = 'review_sms';
