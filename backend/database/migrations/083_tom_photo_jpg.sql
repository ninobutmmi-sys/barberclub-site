-- La photo de Tom etait un AVIF etiquete .png : les navigateurs devinaient le
-- format au contenu, ca marchait par chance. Le shooting de septembre la
-- remplace par un vrai JPEG, et le fichier reprend la bonne extension.
UPDATE barbers
SET photo_url = '/barbers/tom.jpg'
WHERE photo_url = '/barbers/tom.png';
