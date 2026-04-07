-- Migration 043: Add 'reminder_email' to notification_queue type constraint
-- Required for dual-channel reminders (SMS + email backup)

ALTER TABLE notification_queue DROP CONSTRAINT IF EXISTS notification_queue_type_check;
ALTER TABLE notification_queue ADD CONSTRAINT notification_queue_type_check
  CHECK (type IN (
    'confirmation_email', 'confirmation_sms',
    'reminder_sms', 'reminder_email',
    'review_email',
    'cancellation_email', 'reschedule_email',
    'waitlist_sms', 'no_show_sms',
    'campaign_sms', 'campaign_email'
  ));
