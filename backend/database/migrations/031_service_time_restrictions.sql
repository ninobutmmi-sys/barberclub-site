-- Migration 031: Add time_restrictions to services
-- Allows restricting a service to specific days/time windows
-- Format: [{"day_of_week": 2, "start_time": "09:00", "end_time": "13:00"}, ...]
-- day_of_week: 0=Monday, 6=Sunday (project convention)

ALTER TABLE services ADD COLUMN IF NOT EXISTS time_restrictions JSONB DEFAULT NULL;

-- Create "Coupe Étudiante" for Grenoble (Clément only)
-- Wednesday morning until 13:00, Friday until 11:00
INSERT INTO services (name, description, price, duration, is_active, sort_order, color, salon_id, time_restrictions)
VALUES (
  'Coupe Étudiante',
  'Disponible mercredi matin et vendredi matin uniquement',
  1500,
  20,
  true,
  99,
  '#3b82f6',
  'grenoble',
  '[{"day_of_week": 2, "start_time": "09:00", "end_time": "13:00"}, {"day_of_week": 4, "start_time": "09:00", "end_time": "11:00"}]'::jsonb
);

-- Assign to Clément only
INSERT INTO barber_services (barber_id, service_id)
SELECT 'b1000000-0000-0000-0000-000000000004', id
FROM services WHERE name = 'Coupe Étudiante' AND salon_id = 'grenoble' AND deleted_at IS NULL;
