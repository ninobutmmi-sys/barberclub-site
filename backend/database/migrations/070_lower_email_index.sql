-- 070 — index sur LOWER(email)
--
-- Les recherches d'authentification comparent désormais `LOWER(email) = $1`
-- (connexion, inscription, mot de passe oublié). Sans index fonctionnel,
-- chacune de ces requêtes parcourt les ~9 900 fiches clients.
-- L'index partiel existant sur `email` ne peut pas servir : il porte sur la
-- valeur brute, pas sur sa version minuscule.

CREATE INDEX IF NOT EXISTS idx_clients_email_lower
  ON clients (LOWER(email))
  WHERE deleted_at IS NULL AND email IS NOT NULL;
