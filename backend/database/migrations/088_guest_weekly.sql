-- ============================================
-- Migration 088 : un jour fixe dans un autre salon
--
-- Julien travaille à Grenoble tous les jeudis, sans date de fin. Les
-- guest_assignments ne savent dire qu'une date à la fois : il fallait les
-- ressaisir, et la semaine type ne peut pas porter un autre salon
-- (UNIQUE barber_id, day_of_week).
--
-- La règle vit ici ; les dates concrètes restent dans guest_assignments, que
-- la disponibilité, le planning et la page de réservation lisent déjà.
-- services/guestWeekly.js les génère sur six mois glissants.
-- ============================================

CREATE TABLE IF NOT EXISTS guest_weekly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  host_salon_id VARCHAR(20) NOT NULL REFERENCES salons(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = lundi
  start_time TIME NOT NULL DEFAULT '09:00',
  end_time TIME NOT NULL DEFAULT '19:00',
  -- Dernière date déjà générée : un jour supprimé à la main n'est pas recréé.
  generated_until DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (barber_id, day_of_week),
  CHECK (end_time > start_time)
);

ALTER TABLE guest_weekly ENABLE ROW LEVEL SECURITY;
