-- Migration 023: Audit log table
-- Tracks admin actions for accountability

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id VARCHAR(50) NOT NULL DEFAULT 'meylan',
  actor_id UUID NOT NULL,
  actor_name VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(255),
  details JSONB DEFAULT '{}',
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for filtering by salon + date (most common query)
CREATE INDEX idx_audit_log_salon_date ON audit_log (salon_id, created_at DESC);

-- Index for filtering by entity
CREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id);

-- Auto-cleanup: delete entries older than 6 months (run via cron)
-- SELECT COUNT(*) FROM audit_log WHERE created_at < NOW() - INTERVAL '6 months';

-- Enable RLS
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
