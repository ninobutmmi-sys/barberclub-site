-- ============================================
-- Migration 100 : Benji revient à Meylan, cinq jours en octobre
--
-- Jeudi 8, samedi 17, mercredi 21, mercredi 28 et jeudi 29 octobre 2026,
-- de 10h à 19h. Profil 985ae398 (l'autre ligne « Benji » est supprimée).
--
-- Sa semaine type passe entièrement en repos : seuls les cinq overrides
-- ouvrent des créneaux, et le contrat (8 → 29 oct.) refuse tout RDV en
-- dehors. Un autre jour se rouvre depuis le planning (bouton « Ouvrir »).
-- ============================================

UPDATE barbers
SET is_active = true, contract_start = '2026-10-08', contract_end = '2026-10-29'
WHERE id = '985ae398-39ab-414e-9c91-4afe829b24a6';

UPDATE schedules SET is_working = false
WHERE barber_id = '985ae398-39ab-414e-9c91-4afe829b24a6' AND salon_id = 'meylan';

DELETE FROM schedule_overrides
WHERE barber_id = '985ae398-39ab-414e-9c91-4afe829b24a6'
  AND date IN ('2026-10-08', '2026-10-17', '2026-10-21', '2026-10-28', '2026-10-29');

INSERT INTO schedule_overrides (barber_id, date, start_time, end_time, is_day_off, salon_id, reason)
SELECT '985ae398-39ab-414e-9c91-4afe829b24a6', d::date, '10:00', '19:00', false, 'meylan', 'Benji en renfort'
FROM unnest(ARRAY['2026-10-08', '2026-10-17', '2026-10-21', '2026-10-28', '2026-10-29']) AS d;
