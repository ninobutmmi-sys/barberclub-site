-- 072b/073 — le catalogue produits de Voiron
--
-- « Les mêmes que dans les deux salons » : les deux catalogues ne sont pas
-- identiques et contiennent des doublons d'orthographe (« Cire Freeze » et
-- « Cire freeze » à Grenoble, trois graphies du sac BARBERCLUB, « huile
-- cerise » / « Huile cerise » selon le salon). Les recopier tels quels aurait
-- installé la même confusion dans un troisième salon.
--
-- On prend donc la gamme ACTIVE, dédoublonnée, avec des noms unifiés :
-- 6 cires, 3 produits de coiffage, 4 barbe, 3 accessoires.
--
-- Stock à 0 : rien n'est encore livré à Voiron. Seuil d'alerte à 5, la valeur
-- dominante dans les deux salons. Prix d'achat à 0 comme partout ailleurs :
-- il n'est pas suivi aujourd'hui.
--
-- Les accessoires (lames, rouleau CB, sacs) sont `sellable = false` : ce sont
-- des consommables du salon, pas des articles vendus. À Meylan le sac est
-- marqué vendable à 0 € — un article à 0 € ne se vend pas, on ne reprend pas
-- l'incohérence.

INSERT INTO products (name, category, buy_price, sell_price, stock_quantity, alert_threshold, is_active, sellable, salon_id)
SELECT v.name, v.category, 0, v.sell_price, 0, 5, true, v.sellable, 'voiron'
FROM (VALUES
  ('Cire Bubble Gum', 'Cires', 1000, true),
  ('Cire extra strong', 'Cires', 1000, true),
  ('Cire Freeze', 'Cires', 1000, true),
  ('Cire Gold', 'Cires', 1000, true),
  ('Cire Mat Strong', 'Cires', 1000, true),
  ('Cire Wet', 'Cires', 1000, true),
  ('Crème Boucles', 'Coiffage', 1500, true),
  ('Laques', 'Coiffage', 1500, true),
  ('Poudre Texture', 'Coiffage', 1500, true),
  ('Eau de cologne', 'Barbe', 1000, true),
  ('Huile cerise', 'Barbe', 1500, true),
  ('Huile tobacco vanille', 'Barbe', 1500, true),
  ('Huile Azzur Lime', 'Barbe', 1500, true),
  ('Lame Rasoir', 'Accessoire', 0, false),
  ('Rouleau CB', 'Accessoire', 0, false),
  ('SAC BARBER CLUB', 'Accessoire', 0, false)
) AS v(name, category, sell_price, sellable)
WHERE NOT EXISTS (
  SELECT 1 FROM products p WHERE p.salon_id = 'voiron' AND lower(p.name) = lower(v.name)
);
