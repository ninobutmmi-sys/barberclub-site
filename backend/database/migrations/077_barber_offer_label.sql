-- ============================================
-- 077 — Une mention a afficher sur un barbier
-- ============================================
-- Daryl debute : ses prestations sont offertes le temps de sa formation. Un
-- prix a zero se voit sur la page (« Offert »), mais il n'explique rien —
-- un client qui lit « Offert » sans savoir pourquoi se demande s'il y a une
-- erreur, ou ce qu'on lui vendra en plus.
--
-- Cette colonne porte la phrase a afficher a cote du barbier, dans la
-- reservation. Vide = rien ne s'affiche. Elle sert aussi bien a une formation
-- qu'a une promotion ou a une premiere semaine.
ALTER TABLE barbers
  ADD COLUMN IF NOT EXISTS offer_label TEXT;

COMMENT ON COLUMN barbers.offer_label IS
  'Mention affichee sous le nom du barbier a la reservation (formation, promotion). NULL = rien.';
