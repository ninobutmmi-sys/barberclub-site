-- Eddine arrive le 15 septembre. Sa fiche n'avait pas de photo : sur la grille
-- de reservation il n'etait qu'une initiale, et c'est justement la semaine ou
-- la tuile passe en avant qu'il faut un visage.
UPDATE barbers
SET photo_url = '/barbers/eddine.jpg'
WHERE lower(name) = 'eddine' AND salon_id = 'grenoble';
