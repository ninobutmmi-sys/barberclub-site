-- Migration 030: Saturday-specific service duration
-- Allows services to have a different duration on Saturdays
-- Use case: Coupe Étudiante = 30min normally, 20min on Saturdays (busier day)

ALTER TABLE services ADD COLUMN IF NOT EXISTS duration_saturday INTEGER DEFAULT NULL;

-- Coupe Études Supérieures (30min) at Meylan: 20 min on Saturdays
UPDATE services SET duration_saturday = 20
WHERE id = 'a0000000-0000-0000-0000-000000000004' AND deleted_at IS NULL;
