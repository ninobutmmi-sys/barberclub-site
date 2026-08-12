-- Migration 068: fiche client — anniversaire et préférences
--
-- La fiche ne portait que l'état civil et des notes internes libres. Deux
-- manques revenaient :
--
--   birth_date   Un barbier qui sait que le client a son anniversaire la
--                semaine prochaine peut le lui souhaiter au fauteuil. C'est
--                aussi la base d'une attention commerciale (offre annuelle).
--
--   preferences  Ce qu'il faut savoir AVANT de commencer la coupe : « dégradé
--                bas, jamais de tondeuse sur le dessus », « allergique au
--                parfum ». Aujourd'hui ça se noyait dans les notes internes,
--                qui servent aussi à consigner les incidents et les impayés.
--                Deux usages, deux champs : on ne lit pas un avertissement de
--                coupe au milieu d'un historique de litiges.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS preferences TEXT;

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_preferences_check;
ALTER TABLE clients ADD CONSTRAINT clients_preferences_check
  CHECK (preferences IS NULL OR length(preferences) <= 1000);

-- Bornes fixes seulement. CURRENT_DATE dans un CHECK n'est évalué qu'à
-- l'écriture : la contrainte deviendrait fausse le lendemain pour les lignes
-- déjà en place. Le « pas dans le futur » est validé côté API, là où il a un
-- sens au moment de la saisie.
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_birth_date_check;
ALTER TABLE clients ADD CONSTRAINT clients_birth_date_check
  CHECK (birth_date IS NULL OR (birth_date > DATE '1900-01-01' AND birth_date < DATE '2100-01-01'));
