-- Migration 060: "Mèches" (Grenoble) passe de 30 min à 20 min
-- Demandé par Nino — durée réelle de la prestation côté salon.
-- Service Mèches Grenoble = a1000000-0000-0000-0000-000000000008 (40,00 €).
-- Aucun barber n'a de custom_duration sur ce service (vérifié), donc la durée
-- du service s'applique à tous.
-- Sans effet sur les RDV existants : bookings stocke son propre end_time.
-- Idempotent (valeur absolue).

UPDATE services
SET duration = 20
WHERE id = 'a1000000-0000-0000-0000-000000000008';
