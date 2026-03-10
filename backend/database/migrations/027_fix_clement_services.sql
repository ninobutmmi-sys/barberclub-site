-- Migration 027: Retirer Coupe Étudiante et Coupe Enfant de Clément
-- Ces services ne devraient pas lui être assignés

DELETE FROM barber_services
WHERE barber_id = 'b1000000-0000-0000-0000-000000000004'
  AND service_id IN (
    'a1000000-0000-0000-0000-000000000004',  -- Coupe Enfant (-12 ans)
    'a1000000-0000-0000-0000-000000000005'   -- Coupe Étudiante
  );
