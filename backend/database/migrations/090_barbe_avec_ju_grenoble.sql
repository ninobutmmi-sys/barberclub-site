-- ============================================
-- Migration 090 : « Barbe avec Ju » à Grenoble, 20 €
--
-- Julien coupe à Grenoble le jeudi avec ses prestations de Meylan, recopiées
-- côté Grenoble et rattachées à lui seul (« Coupe avec Ju », etc.), pour que
-- « peu importe » ne les propose pas. Il lui manquait la barbe seule.
-- Reprise de « Barbe Uniquement » de Meylan : 20 €, 20 min, même couleur.
-- ============================================

INSERT INTO services (name, description, price, duration, color, sort_order, is_active, salon_id)
SELECT 'Barbe avec Ju', 'Barbe : traçage, taillage et huile mangue', 2000, 20, '#34d399',
       COALESCE(MAX(s.sort_order), 0) + 1, true, 'grenoble'
FROM services s
WHERE s.salon_id = 'grenoble' AND s.name LIKE '% avec Ju' AND s.deleted_at IS NULL
HAVING NOT EXISTS (
  SELECT 1 FROM services WHERE salon_id = 'grenoble' AND name = 'Barbe avec Ju' AND deleted_at IS NULL
);

INSERT INTO barber_services (barber_id, service_id)
SELECT b.id, s.id
FROM barbers b
JOIN services s ON s.salon_id = 'grenoble' AND s.name = 'Barbe avec Ju' AND s.deleted_at IS NULL
WHERE b.salon_id = 'meylan' AND b.name ILIKE 'julien%' AND b.deleted_at IS NULL
ON CONFLICT DO NOTHING;
