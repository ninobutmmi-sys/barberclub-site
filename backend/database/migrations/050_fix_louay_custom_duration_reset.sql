-- Migration 050: Re-apply Louay custom_duration UPDATE (idempotent)
-- After migration 046 ran (2026-04-15), Louay was re-assigned to "Coupe Études
-- Supérieures" via the dashboard, which recreated the barber_services row with
-- custom_duration = NULL. Result: bookings for that service fell back to the
-- service default (20 min) instead of Louay's intended 30 min.
-- This migration re-runs the UPDATE so the values match what 046 declares.

UPDATE barber_services SET custom_duration = 30
WHERE barber_id = '5873336f-8ed4-4be5-baf1-1e1877df116f'
  AND custom_duration IS DISTINCT FROM 30
  AND service_id IN (
    SELECT id FROM services
    WHERE name IN ('Coupe Études Supérieures', 'Coupe Homme sans barbe')
      AND salon_id = 'grenoble' AND deleted_at IS NULL
  );
