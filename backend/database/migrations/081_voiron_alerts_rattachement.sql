-- ============================================
-- 081 — Rendre a Voiron ses inscrits
-- ============================================
-- Les premieres inscriptions a l'ouverture de Voiron ont ete enregistrees sous
-- Grenoble : le salon n'existait pas encore en base. Il existe depuis, et la
-- liste du dashboard devait donc interroger par evenement plutot que par
-- salon — ce qui revenait a lever le cloisonnement entre salons pour tout le
-- monde, y compris pour lire la liste d'un autre.
--
-- On repare la donnee au lieu de contourner la regle : ces lignes appartiennent
-- a Voiron, elles y sont rattachees, et la requete peut redevenir stricte.
UPDATE event_alerts
   SET salon_id = 'voiron'
 WHERE event_name = 'ouverture_voiron'
   AND salon_id <> 'voiron';
