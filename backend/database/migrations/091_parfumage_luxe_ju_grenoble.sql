-- ============================================
-- Migration 091 : « + parfumage de luxe » sur les prestations de Julien à Grenoble
--
-- Demande de Julien : chaque détail de ses cases à Grenoble se termine par le
-- parfumage, comme la carte de Voiron. Rejouable : on n'ajoute pas deux fois.
-- ============================================

UPDATE services
SET description = description || ' + parfumage de luxe'
WHERE salon_id = 'grenoble'
  AND name LIKE '% avec Ju'
  AND deleted_at IS NULL
  AND description IS NOT NULL
  AND description NOT ILIKE '%parfumage%';
