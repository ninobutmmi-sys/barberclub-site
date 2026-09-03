-- Un barbier hors du « peu importe »
--
-- « Peu importe » choisit pour le client, en repartissant la charge. Or on ne
-- veut pas toujours y jeter toute l'equipe : un barbier en formation, dont les
-- coupes sont offertes, ne doit pas recuperer les clients qui n'ont pas demande
-- a le voir — a plus forte raison quand son sort_order eleve le rend
-- prioritaire, comme c'etait le cas de Daryl a Meylan.
--
-- Le drapeau ne le retire que de l'attribution automatique : il reste dans la
-- liste publique et reservable par un client qui le choisit nommement. C'est
-- exactement la difference que is_active ne savait pas exprimer — desactiver
-- Daryl le faisait disparaitre du site entier.
ALTER TABLE barbers
  ADD COLUMN IF NOT EXISTS exclude_from_any BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN barbers.exclude_from_any IS
  'true = jamais choisi par « peu importe » ; reste reservable nommement';

UPDATE barbers SET exclude_from_any = true
 WHERE name = 'Daryl' AND salon_id = 'meylan' AND deleted_at IS NULL;
