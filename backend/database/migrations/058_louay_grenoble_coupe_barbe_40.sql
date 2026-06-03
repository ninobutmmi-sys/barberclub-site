-- Migration 058: Coupe + Barbe de Louay à Grenoble = 40 min
-- Louay prend plus de temps sur coupe + barbe → custom_duration 40 (défaut 30).
-- Service "Coupe + Barbe" Grenoble = a1000000-0000-0000-0000-000000000006.
-- Idempotent (valeur absolue).

UPDATE barber_services
SET custom_duration = 40
WHERE barber_id = '5873336f-8ed4-4be5-baf1-1e1877df116f'
  AND service_id = 'a1000000-0000-0000-0000-000000000006';
