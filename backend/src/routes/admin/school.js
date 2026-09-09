// ============================================
// Section École — les apprentis et leurs jours de cours
//
// L'alternance vit dans blocked_slots (type='school') : un jour de cours est un
// blocage comme un autre, que l'admin peut lever d'un clic, et qui empêche la
// réservation côté client. Cette route ne fait que rassembler ce qui est
// éparpillé — qui est en cours, quand, et ce qui n'est pas couvert.
// ============================================

const { Router } = require('express');
const { query } = require('express-validator');
const { handleValidation } = require('../../middleware/validate');
const db = require('../../config/database');
const { getParisTodayISO } = require('../../utils/date');

const router = Router();

// ============================================
// GET /api/admin/school — Vue d'ensemble des apprentis
// ?semaines=N pour la profondeur du calendrier (defaut 4)
// ============================================
router.get('/',
  [query('semaines').optional().isInt({ min: 1, max: 52 }).toInt()],
  handleValidation,
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const today = getParisTodayISO();
      const semaines = req.query.semaines || 4;

      // Une seule requete : toutes les journees d'ecole a venir de l'equipe.
      // On renvoie les dates brutes — c'est au front de decider comment les
      // presenter, et ca evite d'inventer une agregation qui ne servira pas.
      const jours = await db.query(
        `SELECT bs.barber_id,
                to_char(bs.date, 'YYYY-MM-DD') AS date,
                EXTRACT(ISODOW FROM bs.date)::int - 1 AS day_of_week,
                to_char(bs.start_time, 'HH24:MI') AS start_time,
                to_char(bs.end_time, 'HH24:MI')   AS end_time
         FROM blocked_slots bs
         JOIN barbers b ON b.id = bs.barber_id
         WHERE bs.type = 'school'
           AND b.salon_id = $1
           AND b.deleted_at IS NULL
           AND b.is_active = true
           AND bs.date >= $2
         ORDER BY bs.barber_id, bs.date`,
        [salonId, today]
      );

      const barbers = await db.query(
        `SELECT id, name, photo_url,
                to_char(contract_start, 'YYYY-MM-DD') AS contract_start,
                to_char(contract_end,   'YYYY-MM-DD') AS contract_end
         FROM barbers
         WHERE salon_id = $1 AND deleted_at IS NULL AND is_active = true`,
        [salonId]
      );

      // Le filet de securite : une journee de cours ou le barbier reste
      // reservable. C'est exactement le trou par lequel un client aurait pu
      // prendre rendez-vous avec quelqu'un assis en classe.
      const conflits = await db.query(
        `SELECT bk.barber_id, b.name AS barber_name,
                to_char(bk.date, 'YYYY-MM-DD') AS date,
                to_char(bk.start_time, 'HH24:MI') AS start_time,
                c.first_name, c.last_name
         FROM bookings bk
         JOIN barbers b ON b.id = bk.barber_id
         JOIN blocked_slots bs
           ON bs.barber_id = bk.barber_id AND bs.date = bk.date AND bs.type = 'school'
          AND bk.start_time < bs.end_time AND bk.end_time > bs.start_time
         LEFT JOIN clients c ON c.id = bk.client_id
         WHERE b.salon_id = $1 AND bk.status = 'confirmed'
           AND bk.deleted_at IS NULL AND bk.date >= $2
         ORDER BY bk.date, bk.start_time`,
        [salonId, today]
      );

      const parBarbier = new Map();
      for (const j of jours.rows) {
        if (!parBarbier.has(j.barber_id)) parBarbier.set(j.barber_id, []);
        parBarbier.get(j.barber_id).push(j);
      }

      const limite = new Date(`${today}T00:00:00`);
      limite.setDate(limite.getDate() + semaines * 7);
      const limiteISO = limite.toISOString().slice(0, 10);

      const apprentis = [];
      for (const b of barbers.rows) {
        const mesJours = parBarbier.get(b.id) || [];
        if (mesJours.length === 0) continue; // pas d'ecole = pas un apprenti

        // Jours de la semaine systematiques : au moins la moitie des 8
        // premieres semaines de cours. L'alternance est irreguliere — une
        // journee isolee de rattrapage ne definit pas un rythme.
        // La fenetre part de la premiere journee de l'interesse, pas
        // d'aujourd'hui : pour qui commence dans trois semaines, une fenetre
        // ancree au present n'attrapait qu'un bout de son rythme et perdait un
        // de ses deux jours de cours.
        const debut = new Date(`${mesJours[0].date}T00:00:00`);
        debut.setDate(debut.getDate() + 56);
        const finFenetre = debut.toISOString().slice(0, 10);
        const compte = {};
        for (const j of mesJours) {
          if (j.date < finFenetre) compte[j.day_of_week] = (compte[j.day_of_week] || 0) + 1;
        }
        const habituels = Object.entries(compte)
          .filter(([, n]) => n >= 4)
          .map(([d]) => Number(d))
          .sort((a, b) => a - b);

        apprentis.push({
          barber_id: b.id,
          name: b.name,
          photo_url: b.photo_url,
          contract_start: b.contract_start,
          contract_end: b.contract_end,
          habituels,
          prochaine: mesJours[0].date,
          derniere: mesJours[mesJours.length - 1].date,
          restantes: mesJours.length,
          en_cours_aujourdhui: mesJours.some((j) => j.date === today),
          calendrier: mesJours.filter((j) => j.date <= limiteISO),
        });
      }

      apprentis.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

      res.json({
        today,
        semaines,
        apprentis,
        conflits: conflits.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
