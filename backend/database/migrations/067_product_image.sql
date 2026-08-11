-- Migration 067: photo de produit
--
-- La page Stock est une grille de cartes : sans visuel, il faut lire chaque nom
-- pour retrouver un produit qu'on a pourtant en main. Les barbiers reconnaissent
-- un flacon avant d'en lire l'étiquette.
--
-- Même stockage que les photos de barbiers : une data URL base64 dans une
-- colonne TEXT. Pas de bucket à gérer, pas de fichier à déployer, le salon reste
-- autonome. Le dashboard redimensionne à 400px avant d'envoyer — une photo de
-- téléphone brute ferait 2 Mo, et la liste en charge seize d'un coup.

ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
