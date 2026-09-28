-- ============================================
-- Migration 094 : Alan commence à 9h le mardi
--
-- Ses horaires du mardi démarraient à 10h depuis le seed de Grenoble (018),
-- donc le site ne proposait rien avant. Il prend à 9h chaque mardi. Seul le
-- début change : l'heure de fin saisie en base reste celle d'aujourd'hui.
-- day_of_week 1 = mardi (0 = lundi).
-- ============================================

UPDATE schedules
SET start_time = '09:00'
WHERE barber_id = 'b1000000-0000-0000-0000-000000000002'
  AND day_of_week = 1
  AND salon_id = 'grenoble'
  AND is_working = true;
