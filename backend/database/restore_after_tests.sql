-- ============================================
-- BarberClub — Restaurer config apres tests
-- Remettre delay_minutes a 60 min (production)
-- ============================================

UPDATE automation_triggers
SET config = jsonb_set(config, '{delay_minutes}', '60')
WHERE type = 'review_sms';

-- Verification
SELECT type, salon_id, is_active, config->>'delay_minutes' AS delay_minutes
FROM automation_triggers
WHERE type = 'review_sms';
