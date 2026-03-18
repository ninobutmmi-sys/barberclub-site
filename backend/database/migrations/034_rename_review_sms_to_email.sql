-- Migration 034: Rename review_sms → review_email in automation_triggers
-- The trigger now sends an email (not SMS), name should reflect that

-- 1. Rename trigger type in automation_triggers
UPDATE automation_triggers SET type = 'review_email' WHERE type = 'review_sms';

-- 2. Update existing notification_queue rows BEFORE changing constraint
UPDATE notification_queue SET type = 'review_email' WHERE type = 'review_sms';

-- 3. Now safe to update constraint (no more review_sms rows)
ALTER TABLE notification_queue DROP CONSTRAINT IF EXISTS notification_queue_type_check;
ALTER TABLE notification_queue ADD CONSTRAINT notification_queue_type_check
  CHECK (type IN (
    'confirmation_email', 'confirmation_sms',
    'reminder_sms', 'review_email',
    'cancellation_email', 'reschedule_email',
    'waitlist_sms', 'no_show_sms',
    'campaign_sms', 'campaign_email'
  ));
