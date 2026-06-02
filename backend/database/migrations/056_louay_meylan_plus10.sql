-- Migration 056: Louay +10 min sur toutes ses prestations Meylan
-- Louay (guest samedi à Meylan) est plus lent → custom_duration = durée par défaut + 10
-- pour CHACUNE de ses prestations Meylan. Idempotent (valeur absolue, pas un incrément).
-- Remplace les custom_duration ad hoc de la migration 052 par une règle uniforme.

UPDATE barber_services bs
SET custom_duration = s.duration + 10
FROM services s
WHERE bs.service_id = s.id
  AND bs.barber_id = '5873336f-8ed4-4be5-baf1-1e1877df116f'
  AND s.salon_id = 'meylan'
  AND s.deleted_at IS NULL;
