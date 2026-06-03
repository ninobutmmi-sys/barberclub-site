-- Migration 057: Coupe Enfant (-12 ans) de Louay à Grenoble = 30 min
-- Louay (5873336f-...) prend plus de temps sur les coupes enfant → custom_duration 30
-- (défaut du service = 20). Service enfant Grenoble = a1000000-0000-0000-0000-000000000004.
-- Idempotent (valeur absolue).

UPDATE barber_services
SET custom_duration = 30
WHERE barber_id = '5873336f-8ed4-4be5-baf1-1e1877df116f'
  AND service_id = 'a1000000-0000-0000-0000-000000000004';
