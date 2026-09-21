-- ============================================
-- Migration 093 : le parfumage de luxe sur toute la carte de Grenoble
--
-- Grenoble termine désormais chaque prestation par le parfumage, comme Meylan
-- et Voiron. On l'ajoute à la fin de chaque description pour qu'il apparaisse
-- dans le parcours de réservation : les cases y affichent cette colonne.
--
-- Les prestations de Julien (« ... avec Ju ») l'ont déjà reçu en 091, et la
-- coupe enfant reste sans parfumage, comme à Meylan et à Voiron.
-- Rejouable : on n'ajoute pas deux fois.
-- ============================================

UPDATE services
SET description = description || ' + parfumage de luxe'
WHERE salon_id = 'grenoble'
  AND deleted_at IS NULL
  AND description IS NOT NULL
  AND description <> ''
  AND description NOT ILIKE '%parfumage%'
  AND name NOT ILIKE '%enfant%';
