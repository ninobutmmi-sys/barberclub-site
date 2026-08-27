-- 071 — le troisième salon
--
-- Voiron ouvre en octobre 2026. La ligne doit exister avant tout le reste :
-- `salon_id` est une clé étrangère de fait sur barbers, services, schedules,
-- bookings et client_salons.
--
-- L'équipe et les prestations ne sont PAS créées ici : elles seront saisies
-- à la main depuis le dashboard (Clément arrive en octobre, deux autres
-- employés à venir, Julien deux jours par semaine).

INSERT INTO salons (id, name, address, phone)
VALUES ('voiron', 'BarberClub Voiron', '5 Av. Léon et Joanny Tardy, 38500 Voiron', '')
ON CONFLICT (id) DO NOTHING;
