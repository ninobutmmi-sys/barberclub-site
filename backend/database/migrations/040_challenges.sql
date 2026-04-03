-- Challenges table for custom barber objectives/trophies
CREATE TABLE IF NOT EXISTS challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id TEXT NOT NULL,
  title TEXT NOT NULL,
  target_value INT NOT NULL,
  metric_type TEXT NOT NULL DEFAULT 'custom',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_challenges_salon ON challenges(salon_id);
