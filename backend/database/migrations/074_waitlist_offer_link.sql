-- 074 — un lien court dans le SMS de liste d'attente
--
-- Le SMS se terminait par « Reservez vite au salon ou appelez-nous ». Mesuré
-- sur 296 notifiés : 164 finissent par réserver (55 %), mais avec un délai
-- MÉDIAN de 48 heures. L'intention est créée, l'action est repoussée parce
-- qu'il faut téléphoner ou se déplacer.
--
-- `offer_token` porte un code court (6 caractères) résolu par /r/w/:code, ce
-- qui garde le SMS sous 155 caractères — donc à 1 crédit.
-- `offer_clicked_at` permet de savoir si le lien sert vraiment, plutôt que de
-- le supposer.

ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS offer_token VARCHAR(12);
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS offer_clicked_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_offer_token
  ON waitlist (offer_token) WHERE offer_token IS NOT NULL;

-- Le barbier du créneau proposé n'est pas toujours celui que la personne
-- attendait : depuis le « second rideau », on propose aussi les créneaux des
-- autres barbiers du salon. Le lien doit donc ouvrir sur le barbier de
-- L'OFFRE, pas sur `waitlist.barber_id`.
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS offer_barber_id UUID REFERENCES barbers(id);
