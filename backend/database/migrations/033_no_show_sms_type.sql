-- Migration 033: Add no_show_sms notification type
ALTER TABLE notification_queue DROP CONSTRAINT IF EXISTS notification_queue_type_check;
ALTER TABLE notification_queue ADD CONSTRAINT notification_queue_type_check
  CHECK (type IN (
    'confirmation_email', 'confirmation_sms',
    'reminder_sms', 'review_sms',
    'cancellation_email', 'reschedule_email',
    'waitlist_sms', 'no_show_sms',
    'campaign_sms', 'campaign_email',
    'review_email'
  ));
