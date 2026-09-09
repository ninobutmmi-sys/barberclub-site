-- ============================================
-- Migration 087 : le motif « école » devient un vrai type
--
-- Six barbiers sont en alternance (Tom, Nathan, Alan, Daryl, Eddine, Durel).
-- Jusqu'ici leurs jours de cours se saisissaient en tapant « ECOLE » à la main
-- dans le champ raison : 137 lignes, réparties entre type='closed' et
-- type='break' selon l'humeur du jour. Impossible de compter les heures
-- réellement passées au salon, impossible d'afficher autre chose qu'un trou
-- dans le planning.
--
-- On ajoute le type. Le libellé cesse d'être du texte libre, donc il cesse de
-- se tromper.
-- ============================================

ALTER TABLE blocked_slots DROP CONSTRAINT IF EXISTS blocked_slots_type_check;

ALTER TABLE blocked_slots ADD CONSTRAINT blocked_slots_type_check
  CHECK (type IN ('break', 'personal', 'closed', 'school'));

-- Les lignes existantes portent l'information dans la raison : on la remonte
-- dans le type. « ECOLE », « École », « ecole » — la casse et les accents ont
-- varié, d'où le unaccent maison plutôt qu'un simple upper().
UPDATE blocked_slots
SET type = 'school'
WHERE type <> 'school'
  AND translate(upper(coalesce(reason, '')), 'ÉÈÊË', 'EEEE') LIKE '%ECOLE%';

-- Index partiel : la section École interroge « qui est en cours, et quand »,
-- sur une table qui contient surtout des pauses déjeuner.
CREATE INDEX IF NOT EXISTS idx_blocked_slots_school
  ON blocked_slots (barber_id, date)
  WHERE type = 'school';
