-- Migration 046: Add custom_duration to barber_services for per-barber duration overrides
-- When set, overrides the service's default duration for this barber

ALTER TABLE barber_services ADD COLUMN custom_duration INTEGER;

-- Louay: Coupe Études Supérieures = 30min (default is 20min)
-- Louay: Coupe Homme sans barbe = 30min (default is 20min)
UPDATE barber_services SET custom_duration = 30
WHERE barber_id = '5873336f-8ed4-4be5-baf1-1e1877df116f'
  AND service_id IN (
    SELECT id FROM services WHERE name IN ('Coupe Études Supérieures', 'Coupe Homme sans barbe')
    AND salon_id = 'grenoble'
  );
