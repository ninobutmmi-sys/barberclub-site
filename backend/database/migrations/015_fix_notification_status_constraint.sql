-- Migration 015: Fix notification_queue status constraint
-- The code uses 'processing' status for atomic claim but the constraint was missing it
ALTER TABLE notification_queue DROP CONSTRAINT notification_queue_status_check;
ALTER TABLE notification_queue ADD CONSTRAINT notification_queue_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'failed'));
