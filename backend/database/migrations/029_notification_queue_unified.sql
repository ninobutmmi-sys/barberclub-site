-- Migration 029: Unify notification queue for all notification types
-- All notifications now go through the queue with retry support

-- 1. Add missing columns for full queue support
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 2. Update type constraint to include ALL notification types
ALTER TABLE notification_queue DROP CONSTRAINT IF EXISTS notification_queue_type_check;
ALTER TABLE notification_queue ADD CONSTRAINT notification_queue_type_check
  CHECK (type IN (
    'confirmation_email', 'confirmation_sms',
    'reminder_sms', 'review_sms',
    'cancellation_email', 'reschedule_email',
    'waitlist_sms',
    'campaign_sms', 'campaign_email',
    'review_email'
  ));

-- 3. Index for faster queue processing
CREATE INDEX IF NOT EXISTS idx_notifications_pending_retry
  ON notification_queue (next_retry_at)
  WHERE status = 'pending' AND attempts < max_attempts;
