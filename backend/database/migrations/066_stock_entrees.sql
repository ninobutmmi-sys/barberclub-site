-- Migration 066: les mouvements de stock peuvent entrer, pas seulement sortir
--
-- La table ne modélisait que des retraits (usage interne, perte, inventaire).
-- Résultat : à la réception d'une commande, le barbier devait ouvrir « Modifier
-- le produit » et recalculer le total à la main — 9 en stock, 12 reçus, il tape
-- 21 et se trompe d'un. Aucune trace non plus de qui a réceptionné quoi.
--
-- On garde quantity > 0 (une quantité reste une quantité) et on ajoute le sens
-- du mouvement. Les lignes existantes sont toutes des sorties : 'out' par
-- défaut, aucune reprise de données nécessaire.
--
--   restock   (in)      réception d'une commande fournisseur
--   inventory (in|out)  correction après comptage, dans les deux sens
--   internal_use (out)  consommé pour coiffer
--   loss      (out)     casse, vol, périmé

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS direction VARCHAR(3) NOT NULL DEFAULT 'out';

ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_direction_check;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_direction_check CHECK (direction IN ('in', 'out'));

ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reason_check;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason IN ('internal_use', 'loss', 'inventory', 'restock'));

-- Une réception entre toujours, une consommation sort toujours. Seul
-- l'inventaire est libre. Sans ça une faute de frappe côté API pourrait
-- créditer du stock au motif « perte ».
ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reason_direction_check;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_reason_direction_check CHECK (
    (reason = 'restock' AND direction = 'in')
    OR (reason IN ('internal_use', 'loss') AND direction = 'out')
    OR (reason = 'inventory')
  );
