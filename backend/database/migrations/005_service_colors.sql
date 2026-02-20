-- ============================================
-- Migration 005: Add color to services
-- ============================================

-- Add color column (hex color code, e.g. '#22c55e')
ALTER TABLE services ADD COLUMN IF NOT EXISTS color VARCHAR(7) DEFAULT '#22c55e';

-- Set distinct default colors for existing services
UPDATE services SET color = '#22c55e' WHERE name ILIKE 'Coupe Homme' AND name NOT ILIKE '%barbe%' AND name NOT ILIKE '%contour%' AND name NOT ILIKE '%CE%' AND name NOT ILIKE '%partenaire%' AND name NOT ILIKE '%enfant%' AND name NOT ILIKE '%études%' AND name NOT ILIKE '%collège%';
UPDATE services SET color = '#3b82f6' WHERE name ILIKE '%contours de barbe%' AND name NOT ILIKE '%CE%' AND name NOT ILIKE '%partenaire%';
UPDATE services SET color = '#8b5cf6' WHERE name ILIKE 'Coupe Homme + Barbe' AND name NOT ILIKE '%serviette%' AND name NOT ILIKE '%CE%' AND name NOT ILIKE '%partenaire%';
UPDATE services SET color = '#f59e0b' WHERE name ILIKE '%études%' AND duration = 30;
UPDATE services SET color = '#ec4899' WHERE name ILIKE '%études%' AND duration = 20;
UPDATE services SET color = '#14b8a6' WHERE name ILIKE '%serviette chaude%' AND name ILIKE '%coupe%';
UPDATE services SET color = '#ef4444' WHERE name ILIKE 'Barbe Uniquement%';
UPDATE services SET color = '#6366f1' WHERE name ILIKE 'Barbe + Serviette%';
UPDATE services SET color = '#06b6d4' WHERE name ILIKE '%partenaire%' AND name NOT ILIKE '%contour%' AND name NOT ILIKE '%barbe%';
UPDATE services SET color = '#d946ef' WHERE name ILIKE '%Contours de Barbe (CE)%' OR (name ILIKE '%partenaire%' AND name ILIKE '%contour%');
UPDATE services SET color = '#84cc16' WHERE name ILIKE '%Barbe Partenaire%' OR (name ILIKE '%partenaire%' AND name ILIKE '%barbe%');
UPDATE services SET color = '#f97316' WHERE name ILIKE '%enfant%';
