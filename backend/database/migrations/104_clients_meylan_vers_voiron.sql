-- ============================================
-- Migration 104 : les clients de Meylan rattachés aussi à Voiron
--
-- Voiron ouvre le 21 octobre sans fichier client. Les clients de Meylan
-- deviennent aussi clients de Voiron : visibles dans le dashboard Voiron,
-- joignables par ses campagnes SMS et mailing. Rien n'est dupliqué : on
-- ajoute une ligne client_salons (client, 'voiron'), le client reste le même
-- (même fiche, même historique, toujours rattaché à Meylan).
--
-- Pas d'ON CONFLICT : NOT EXISTS, pour ne pas dépendre d'une contrainte
-- d'unicité qui peut manquer en prod (cf. migration 103). Rejouable.
-- ============================================

DO $$
DECLARE n int;
BEGIN
  INSERT INTO client_salons (client_id, salon_id)
  SELECT DISTINCT m.client_id, 'voiron'
  FROM client_salons m
  WHERE m.salon_id = 'meylan'
    AND NOT EXISTS (SELECT 1 FROM client_salons v WHERE v.client_id = m.client_id AND v.salon_id = 'voiron');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Clients de Meylan rattachés à Voiron : %', n;
END $$;
