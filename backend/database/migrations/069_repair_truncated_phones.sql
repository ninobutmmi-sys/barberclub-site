-- ============================================================================
-- 069 — Répare les mobiles français amputés de leur 0
-- ============================================================================
-- 410 fiches sont stockées en `+6XXXXXXXX` / `+7XXXXXXXX` au lieu de
-- `+336XXXXXXXX` : en E.164 ce n'est plus la France mais l'Australie ou la
-- Russie. Les SMS partaient quand même (rattrapage à l'envoi depuis le
-- 2026-07-28), mais la base restait fausse et le dashboard affichait un
-- drapeau étranger sur des clients français.
--
-- Les tentatives précédentes de correction en base n'avaient pas persisté à
-- cause de `synchronous_commit = off`, réglage d'urgence posé pendant
-- l'incident disque du 2026-07-02. Ce réglage est repassé à `on` : les
-- écritures tiennent de nouveau.
--
-- Sûr : un vrai numéro étranger en +6X/+7X compte au moins 10 chiffres après
-- le « + ». On ne touche qu'aux 9 chiffres exactement, longueur qui ne
-- correspond à aucun numéro international valide.
--
-- Les fiches dont la version corrigée existe DÉJÀ sous une autre fiche sont
-- laissées telles quelles : ce sont deux enregistrements de la même personne,
-- et fusionner demande de choisir quel historique garder. Contrainte
-- `clients_phone_key` (UNIQUE sur phone, sans filtre sur deleted_at) : le
-- NOT EXISTS ci-dessous ne filtre donc pas non plus sur deleted_at.
-- ============================================================================

UPDATE clients c
SET phone = '+33' || substring(c.phone FROM 2)
WHERE c.phone ~ '^\+[67][0-9]{8}$'
  AND c.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM clients d
    WHERE d.phone = '+33' || substring(c.phone FROM 2)
      AND d.id <> c.id
  );
