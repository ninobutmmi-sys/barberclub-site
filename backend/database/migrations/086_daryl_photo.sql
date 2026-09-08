-- Daryl a commence le 2 septembre sans photo : sur la grille de reservation
-- il n'etait qu'un fauteuil vide au point d'interrogation, alors qu'il coupe
-- depuis une semaine.
UPDATE barbers
SET photo_url = '/barbers/daryl.jpg'
WHERE lower(name) = 'daryl' AND salon_id = 'meylan';
