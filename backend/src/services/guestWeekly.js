const db = require('../config/database');
const logger = require('../utils/logger');

// Jours fixes dans un autre salon (Julien à Grenoble le jeudi).
// Chaque règle de guest_weekly devient des lignes guest_assignments sur six
// mois glissants, un peu plus que l'avance de réservation, pour que le reste du
// code n'ait rien à apprendre. generated_until retient la dernière date écrite :
// on ne repart que de là, donc un jeudi supprimé à la main reste supprimé.

const HORIZON = "CURRENT_DATE + INTERVAL '6 months 7 days'";

async function extendGuestWeekly({ ruleId = null, queryFn = db.query } = {}) {
  const inserted = await queryFn(
    `INSERT INTO guest_assignments (barber_id, host_salon_id, date, start_time, end_time)
     SELECT r.barber_id, r.host_salon_id, d::date, r.start_time, r.end_time
     FROM guest_weekly r
     CROSS JOIN LATERAL generate_series(
       GREATEST(r.generated_until + 1, CURRENT_DATE)::timestamp,
       (${HORIZON})::timestamp,
       INTERVAL '1 day'
     ) AS d
     WHERE EXTRACT(ISODOW FROM d) - 1 = r.day_of_week
       AND ($1::uuid IS NULL OR r.id = $1)
     ON CONFLICT (barber_id, date) DO NOTHING`,
    [ruleId]
  );
  await queryFn(
    `UPDATE guest_weekly SET generated_until = (${HORIZON})::date
     WHERE $1::uuid IS NULL OR id = $1`,
    [ruleId]
  );
  return inserted.rowCount;
}

// Cron quotidien
async function extendAllGuestWeekly() {
  try {
    const n = await extendGuestWeekly();
    if (n > 0) logger.info(`Jours fixes invités : ${n} dates ajoutées`);
  } catch (error) {
    logger.error('Failed to extend guest weekly days', { error: error.message });
  }
}

module.exports = { extendGuestWeekly, extendAllGuestWeekly };
