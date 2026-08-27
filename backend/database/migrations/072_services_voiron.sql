-- 072 — la carte des prestations de Voiron
--
-- Recopiée telle quelle depuis la page publique pages/voiron/index.html, qui
-- fait foi : c'est ce que les clients lisent depuis l'annonce d'ouverture.
-- Prix en centimes. Les couleurs suivent celles des prestations équivalentes
-- à Meylan, pour que le planning se lise pareil d'un salon à l'autre.
--
-- Aucun barbier n'est rattaché ici : le formulaire de création d'un barbier
-- coche toutes les prestations du salon par défaut.

INSERT INTO services (name, description, price, duration, color, sort_order, is_active, salon_id)
SELECT v.name, v.description, v.price, v.duration, v.color, v.sort_order, true, 'voiron'
FROM (VALUES
  ('Coupe Homme', 'Shampooing, coupe, coiffage + parfumage luxe', 2500, 30, '#22d3ee', 0),
  ('Coupe + Traçage Barbe', 'Coupe cheveux, shampooing, coiffage + traçage et soin barbe + parfumage luxe', 3000, 30, '#a78bfa', 1),
  ('Coupe + Barbe', 'Coupe cheveux, shampooing, coiffage + traçage et taillage barbe + parfumage luxe', 3500, 30, '#3b82f6', 2),
  ('Coupe + Barbe + Soin Complet', 'Coupe, shampooing massage, coiffage + barbe complète + serviette chaude + soin visage + parfumage luxe', 4500, 40, '#64748b', 3),
  ('Barbe Uniquement', 'Traçage, taillage et huile mangue + parfumage luxe', 2000, 20, '#34d399', 4),
  ('Soin Visage + Barbe', 'Taillage et traçage barbe + huile mangue + serviette chaude + vapozone et crème hydratante + parfumage luxe', 2500, 30, '#6366f1', 5),
  ('Coupe Étudiante', 'Coupe cheveux, shampooing, coiffage, sur présentation de la carte', 2000, 30, '#f43f5e', 6),
  ('Coupe Enfant', 'Coupe cheveux, shampooing, coiffage — moins de 12 ans', 2000, 20, '#f472b6', 7),
  ('Coupe Partenaire', 'Coupe cheveux, shampooing, coiffage, comité d''entreprise', 2000, 20, '#fbbf24', 8),
  ('Coupe + Traçage Partenaire', 'Coupe cheveux, shampooing, coiffage + traçage et soin barbe + parfumage luxe, comité d''entreprise', 2500, 20, '#d946ef', 9),
  ('Coupe + Barbe Partenaire', 'Coupe cheveux, shampooing, coiffage + traçage et taillage barbe, comité d''entreprise', 3000, 30, '#f97316', 10)
) AS v(name, description, price, duration, color, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM services s
  WHERE s.salon_id = 'voiron' AND s.name = v.name AND s.deleted_at IS NULL
);
