-- ============================================
-- Migration 098 : ouvrir ou fermer la réservation en ligne d'un salon
--
-- Voiron est prêt avant d'ouvrir : équipe, prestations, pages. Tant que la
-- date d'ouverture n'est pas fixée, le site, mon-rdv et l'app ne doivent
-- rien pouvoir réserver ; le dashboard, lui, peut déjà prendre des RDV.
-- L'interrupteur vit dans le dashboard (Système), Nino l'active le jour J.
--
-- true par défaut : Meylan et Grenoble ne changent pas.
-- ============================================

ALTER TABLE salons ADD COLUMN IF NOT EXISTS online_booking_open BOOLEAN NOT NULL DEFAULT true;

UPDATE salons SET online_booking_open = false WHERE id = 'voiron';
