-- ============================================
-- Migration 089 : Julien coupe à Grenoble tous les jeudis
--
-- Jusqu'ici seuls les jeudis 17 et 24 septembre étaient saisis ; le planning
-- de Grenoble montrait Julien barré tous les autres jeudis. Il y travaille
-- désormais chaque semaine, sans date de fin : un jour fixe (migration 088).
--
-- Horaires : ceux déjà saisis pour ses jeudis à Grenoble, sinon 9h-19h.
-- Les dates sont générées ici sur six mois, comme services/guestWeekly.js le
-- fait ensuite chaque nuit. Les RDV déjà pris à Meylan ne bougent pas :
-- l'équipe rappelle les clients.
-- ============================================

INSERT INTO guest_weekly (barber_id, host_salon_id, day_of_week, start_time, end_time)
SELECT b.id, 'grenoble', 3,
       COALESCE(ga.start_time, '09:00'), COALESCE(ga.end_time, '19:00')
FROM barbers b
LEFT JOIN LATERAL (
  SELECT start_time, end_time FROM guest_assignments
  WHERE barber_id = b.id AND host_salon_id = 'grenoble'
  ORDER BY date DESC LIMIT 1
) ga ON TRUE
WHERE b.salon_id = 'meylan' AND b.name ILIKE 'julien%' AND b.deleted_at IS NULL
ON CONFLICT (barber_id, day_of_week) DO NOTHING;

INSERT INTO guest_assignments (barber_id, host_salon_id, date, start_time, end_time)
SELECT r.barber_id, r.host_salon_id, d::date, r.start_time, r.end_time
FROM guest_weekly r
CROSS JOIN LATERAL generate_series(
  GREATEST(r.generated_until + 1, CURRENT_DATE)::timestamp,
  (CURRENT_DATE + INTERVAL '6 months 7 days')::timestamp,
  INTERVAL '1 day'
) AS d
WHERE EXTRACT(ISODOW FROM d) - 1 = r.day_of_week
ON CONFLICT (barber_id, date) DO NOTHING;

UPDATE guest_weekly SET generated_until = (CURRENT_DATE + INTERVAL '6 months 7 days')::date;
