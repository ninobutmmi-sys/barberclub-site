-- Migration 062: Coupe + Barbe de Louay à Grenoble = 30 min (annule la 058)
--
-- La 058 lui avait posé un custom_duration de 40 min. Nino le ramène à 30.
-- Comme 30 min est déjà la durée par défaut du service "Coupe + Barbe" Grenoble
-- (a1000000-...-06), on retire l'exception plutôt que d'y réécrire 30 :
-- availability.js et booking.js ne lisent le custom_duration que s'il est NOT NULL,
-- donc Louay repasse simplement sur la durée standard — et suivra le service si
-- sa durée change un jour, au lieu de rester figé.
--
-- Ne touche à aucun de ses autres custom_duration (Coupe Homme 40, Enfant 30, etc.).
-- Idempotent.

UPDATE barber_services
SET custom_duration = NULL
WHERE barber_id  = '5873336f-8ed4-4be5-baf1-1e1877df116f'  -- Louay (Grenoble)
  AND service_id = 'a1000000-0000-0000-0000-000000000006'; -- Coupe + Barbe (Grenoble, 30,00 €)
