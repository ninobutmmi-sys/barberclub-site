-- ============================================
-- Migration 105 : le planning de Voiron, pour l'ouverture du 21 octobre
--
-- Tableaux de Ju du 08/10 (semaine normale + semaine où Jules est au CFA
-- le lundi). day_of_week 0 = lundi.
--   - Clément : 9h-19h du lundi au samedi, sans pause enregistrée (il place
--     ses pauses lui-même depuis le planning).
--   - Gabriel : mardi, vendredi, samedi 10h-13h / 15h-19h. Lundi repos,
--     mercredi et jeudi CFA.
--   - Jules : lundi, mercredi à samedi 10h-13h / 15h-19h. Mardi repos.
--     Neuf lundis au CFA à partir de l'ouverture (le 12/10 tombe avant).
--   - Julien n'est pas dans les tableaux : sa semaine type reste en repos.
--
-- Personne n'est réservable avant l'ouverture : contract_start au 21/10
-- pour les trois (Gabriel était au 15/10, date de son contrat ; le salon
-- n'ouvre pas avant le 21).
-- ============================================

-- Clément (profil Voiron)
UPDATE schedules
SET is_working = (day_of_week <= 5), start_time = '09:00', end_time = '19:00',
    break_start = NULL, break_end = NULL
WHERE barber_id = '89670916-8e19-49d6-b80b-e3ba695dead4' AND salon_id = 'voiron';

-- Gabriel
UPDATE schedules
SET is_working = (day_of_week IN (1, 4, 5)), start_time = '10:00', end_time = '19:00',
    break_start = '13:00', break_end = '15:00'
WHERE barber_id = 'f1fa01de-9af5-4296-914c-dca33fc2dfe2' AND salon_id = 'voiron';

-- Jules
UPDATE schedules
SET is_working = (day_of_week IN (0, 2, 3, 4, 5)), start_time = '10:00', end_time = '19:00',
    break_start = '13:00', break_end = '15:00'
WHERE barber_id = 'e4b7e90e-83be-4ed4-b3fc-e52d1b3eec6d' AND salon_id = 'voiron';

-- Jules au CFA le lundi
INSERT INTO schedule_overrides (barber_id, date, is_day_off, salon_id, reason)
SELECT 'e4b7e90e-83be-4ed4-b3fc-e52d1b3eec6d', d::date, true, 'voiron', 'CFA'
FROM unnest(ARRAY['2026-11-09', '2026-11-30', '2027-01-11', '2027-02-01', '2027-03-01',
                  '2027-03-22', '2027-04-12', '2027-05-10', '2027-05-31']) AS d
WHERE NOT EXISTS (
  SELECT 1 FROM schedule_overrides o
  WHERE o.barber_id = 'e4b7e90e-83be-4ed4-b3fc-e52d1b3eec6d' AND o.date = d::date
);

-- Rien avant l'ouverture
UPDATE barbers SET contract_start = '2026-10-21'
WHERE id IN ('89670916-8e19-49d6-b80b-e3ba695dead4',
             'f1fa01de-9af5-4296-914c-dca33fc2dfe2',
             'e4b7e90e-83be-4ed4-b3fc-e52d1b3eec6d');
