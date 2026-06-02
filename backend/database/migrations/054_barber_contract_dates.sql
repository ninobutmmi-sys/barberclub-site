-- Migration 054: Dates de contrat pour barbers temporaires (CDD / saisonniers)
-- contract_start / contract_end bornent la période où un barber est réservable.
-- NULL = barber permanent (aucune borne, comportement inchangé).
-- Le bornage est appliqué dans availability.js (getSlotsForBarber + validateBarberSlot)
-- et la liste publique /api/barbers masque le barber une fois contract_end passé.

ALTER TABLE barbers ADD COLUMN IF NOT EXISTS contract_start DATE;
ALTER TABLE barbers ADD COLUMN IF NOT EXISTS contract_end DATE;
