-- Meme histoire que Tom : le fichier servi au dashboard etait un AVIF sous
-- une extension de PNG. Le shooting de septembre le remplace par un vrai
-- JPEG, et le chemin suit.
UPDATE barbers
SET photo_url = '/barbers/lucas.jpg'
WHERE photo_url = '/barbers/lucas.png';
