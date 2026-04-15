-- Migration 045: Louay sort_order = 1 (premier dans la liste réservation Grenoble)
-- Décale les autres barbers Grenoble pour garder l'ordre relatif

UPDATE barbers SET sort_order = sort_order + 1 WHERE salon_id = 'grenoble' AND deleted_at IS NULL;
UPDATE barbers SET sort_order = 1 WHERE id = '5873336f-8ed4-4be5-baf1-1e1877df116f';
