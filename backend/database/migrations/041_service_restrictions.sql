-- Migration 041: Create service_restrictions table + cleanup duplicate student services
-- Replaces the JSON time_restrictions column with a proper relational table
-- Restrictions are a WHITELIST: if rows exist for a barber+service, the barber
-- can ONLY do that service on the listed days/windows.
-- No rows = no restrictions (available whenever scheduled).

-- 1. Create service_restrictions table
CREATE TABLE IF NOT EXISTS service_restrictions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  barber_id UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME DEFAULT NULL,
  end_time TIME DEFAULT NULL,
  salon_id VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(service_id, barber_id, day_of_week, salon_id)
);

CREATE INDEX IF NOT EXISTS idx_service_restrictions_lookup
  ON service_restrictions(service_id, salon_id);

-- 2. Migrate Clément's time_restrictions from the duplicate service to the original
-- The original "Coupe Etudiante" is a1000000-0000-0000-0000-000000000005
-- Clément is b1000000-0000-0000-0000-000000000004

-- Add Clément to the original Coupe Etudiante if not already assigned
INSERT INTO barber_services (barber_id, service_id)
VALUES ('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000005')
ON CONFLICT DO NOTHING;

-- Create restriction rows for Clément: only Wed 09-13 and Fri 09-11
INSERT INTO service_restrictions (service_id, barber_id, day_of_week, start_time, end_time, salon_id)
VALUES
  ('a1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000004', 2, '09:00', '13:00', 'grenoble'),
  ('a1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000004', 4, '09:00', '11:00', 'grenoble')
ON CONFLICT DO NOTHING;

-- 3. Move any bookings from the duplicate service to the original
UPDATE bookings
SET service_id = 'a1000000-0000-0000-0000-000000000005'
WHERE service_id IN (
  SELECT id FROM services
  WHERE name IN ('Coupe Étudiante', 'Coupe Etudiante')
    AND salon_id = 'grenoble'
    AND id != 'a1000000-0000-0000-0000-000000000005'
    AND deleted_at IS NULL
);

-- 4. Soft-delete the duplicate "Coupe Étudiante" from migration 031
UPDATE services
SET deleted_at = NOW(), is_active = false
WHERE name IN ('Coupe Étudiante', 'Coupe Etudiante')
  AND salon_id = 'grenoble'
  AND id != 'a1000000-0000-0000-0000-000000000005'
  AND deleted_at IS NULL;

-- 5. Remove time_restrictions column (no longer needed)
ALTER TABLE services DROP COLUMN IF EXISTS time_restrictions;
