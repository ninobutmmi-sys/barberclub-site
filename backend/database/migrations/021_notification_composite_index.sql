-- Migration 021: Composite index on notification_queue for faster queue processing
-- The query filters on status = 'pending' AND next_retry_at <= NOW()
-- Old index: idx_notifications_pending(next_retry_at) WHERE status = 'pending'
-- New index: composite (status, next_retry_at) — covers both filter columns

DROP INDEX IF EXISTS idx_notifications_pending;
CREATE INDEX idx_notifications_pending ON notification_queue(status, next_retry_at)
    WHERE status = 'pending';
