-- Migration 026: Allow logging all SMS types in notification_queue
-- Adds review_sms + campaign_sms types, makes booking_id optional (for manual SMS),
-- adds salon_id, phone, message columns for complete SMS history

-- 1. Add new SMS types to the constraint
ALTER TABLE notification_queue DROP CONSTRAINT IF EXISTS notification_queue_type_check;
ALTER TABLE notification_queue ADD CONSTRAINT notification_queue_type_check
  CHECK (type IN ('confirmation_email', 'reminder_sms', 'review_sms', 'review_email', 'campaign_sms', 'cancellation_email', 'reschedule_email'));

-- 2. Make booking_id optional (campaign SMS don't have a booking)
ALTER TABLE notification_queue ALTER COLUMN booking_id DROP NOT NULL;

-- 3. Add columns for SMS logging
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(100);
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS channel VARCHAR(10) DEFAULT 'email'
  CHECK (channel IN ('sms', 'email'));

-- 4. Add salon_id if not exists
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS salon_id VARCHAR(20);

-- 5. Index for salon_id filtering
CREATE INDEX IF NOT EXISTS idx_notifications_salon ON notification_queue(salon_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type_salon ON notification_queue(type, salon_id);
