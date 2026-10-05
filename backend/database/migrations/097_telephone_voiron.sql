-- ============================================
-- Migration 097 : le téléphone du salon de Voiron
--
-- Créé vide en 071, faute de ligne à l'époque. Les emails le lisent dans
-- config/env.js (même valeur par défaut) ; la table salons le garde pour
-- tout ce qui lit la base.
-- ============================================

UPDATE salons SET phone = '09 55 20 86 20'
WHERE id = 'voiron' AND (phone IS NULL OR phone = '');
