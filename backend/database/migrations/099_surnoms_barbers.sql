-- ============================================
-- Migration 099 : les surnoms à l'écran
--
-- Julien devient « Ju », Clément « Clem », Alexandre « Alex », dans tous
-- les salons où ils ont un profil. Ciblé par id : les migrations 089 à 096
-- retrouvent Julien avec ILIKE 'julien%' et ne doivent plus rien toucher.
-- Les photos (email, push) suivent via l'alias de helpers.js et push.js.
-- ============================================

UPDATE barbers SET name = 'Ju'
WHERE id IN ('b0000000-0000-0000-0000-000000000002',
             'b4000000-0000-0000-0000-000000000001',
             'b5000000-0000-0000-0000-000000000001');

UPDATE barbers SET name = 'Clem'
WHERE id IN ('b1000000-0000-0000-0000-000000000004',
             '89670916-8e19-49d6-b80b-e3ba695dead4');

UPDATE barbers SET name = 'Alex'
WHERE id = '32072b24-c3f7-4b03-9a6f-3a7f858d6e21';
