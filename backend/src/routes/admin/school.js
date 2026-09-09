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

// Duree d'une journee au CFA, telle qu'imprimee sur les calendriers Ecole
// Terrade (« CENTRE 7,00 »). En apprentissage ce temps s'impute sur les 35 h
// du contrat, il ne s'y ajoute pas — article L6222-24.
const HEURES_PAR_JOUR_CFA = 7;
const CONTRAT_HEBDO = 35;

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

      const ids = barbers.rows.map((b) => b.id);

      // --- Suivi d'apprentissage ---------------------------------------
      // Quatre mesures qui existent deja dans les donnees, et que personne ne
      // regardait. Elles servent au livret d'apprentissage autant qu'a nous.

      // 1. La semaine type, pour compter les heures reellement passees au salon.
      const horaires = await db.query(
        `SELECT barber_id, day_of_week, is_working,
                EXTRACT(EPOCH FROM (end_time - start_time)) / 3600 AS amplitude,
                CASE WHEN break_start IS NOT NULL AND break_end IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (break_end - break_start)) / 3600
                     ELSE 0 END AS pause_declaree
         FROM schedules WHERE salon_id = $1 AND barber_id = ANY($2)`,
        [salonId, ids]
      );

      // Les pauses dejeuner ne vivent pas dans la semaine type mais en blocages
      // recurrents. Sans les deduire, une journee 9h-19h compte 10 h.
      const pauses = await db.query(
        `SELECT barber_id, EXTRACT(ISODOW FROM date)::int - 1 AS day_of_week,
                AVG(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600) AS h
         FROM blocked_slots
         WHERE barber_id = ANY($1) AND type IN ('break', 'closed')
           AND date >= $2 AND (end_time - start_time) < INTERVAL '3 hours'
         GROUP BY 1, 2 HAVING COUNT(*) >= 4`,
        [ids, today]
      );

      // 2. Le catalogue, et ce que chacun a deja pratique. Le referentiel du CAP
      //    s'articule sur la realisation de prestations : la couverture se lit ici.
      const catalogue = await db.query(
        `SELECT id, name, sort_order FROM services
         WHERE salon_id = $1 AND is_active = true AND deleted_at IS NULL
         ORDER BY sort_order, name`,
        [salonId]
      );
      const pratique = await db.query(
        `SELECT barber_id, service_id, COUNT(*)::int AS n
         FROM bookings
         WHERE barber_id = ANY($1) AND status = 'completed' AND deleted_at IS NULL
         GROUP BY 1, 2`,
        [ids]
      );

      // 3. La progression : rendez-vous par journee travaillee, mois par mois.
      const progression = await db.query(
        `SELECT barber_id, to_char(date, 'YYYY-MM') AS mois,
                ROUND(COUNT(*)::numeric / COUNT(DISTINCT date), 1) AS rdv_jour
         FROM bookings
         WHERE barber_id = ANY($1) AND status = 'completed' AND deleted_at IS NULL
           AND date >= CURRENT_DATE - INTERVAL '7 months'
         GROUP BY 1, 2 ORDER BY 1, 2`,
        [ids]
      );

      // 4. La fidelisation : le client revient-il chez le meme ? C'est le second
      //    pole du referentiel, la relation clientele.
      const fidelite = await db.query(
        `WITH visites AS (
           SELECT client_id, barber_id, date,
                  ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY date) AS rn
           FROM bookings
           WHERE status = 'completed' AND deleted_at IS NULL
             AND date >= CURRENT_DATE - INTERVAL '1 year'
         )
         SELECT v.barber_id,
                ROUND(100.0 * COUNT(*) FILTER (WHERE s.barber_id = v.barber_id)
                      / NULLIF(COUNT(*), 0))::int AS taux,
                COUNT(*)::int AS visites
         FROM visites v
         JOIN visites s ON s.client_id = v.client_id AND s.rn = v.rn + 1
         WHERE v.barber_id = ANY($1)
         GROUP BY 1`,
        [ids]
      );

      const indexer = (rows, cle) => {
        const m = new Map();
        for (const r of rows) {
          if (!m.has(r[cle])) m.set(r[cle], []);
          m.get(r[cle]).push(r);
        }
        return m;
      };
      const horairesPar = indexer(horaires.rows, 'barber_id');
      const pausesPar = indexer(pauses.rows, 'barber_id');
      const pratiquePar = indexer(pratique.rows, 'barber_id');
      const progressionPar = indexer(progression.rows, 'barber_id');
      const fidelitePar = new Map(fidelite.rows.map((r) => [r.barber_id, r]));

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

        // --- Heures : ce qu'il reste au salon une fois le CFA compte ---
        // Un jour d'ecole n'est pas un jour de salon : on le retire de la
        // semaine type avant de sommer, sinon on compte deux fois.
        const setEcole = new Set(habituels);
        const pausesJour = new Map(
          (pausesPar.get(b.id) || []).map((r) => [Number(r.day_of_week), Number(r.h)])
        );
        let salonNet = 0;
        let joursSalon = 0;
        for (const h of horairesPar.get(b.id) || []) {
          if (!h.is_working || setEcole.has(h.day_of_week)) continue;
          joursSalon++;
          salonNet += Number(h.amplitude)
            - Number(h.pause_declaree)
            - (pausesJour.get(h.day_of_week) || 0);
        }
        const heuresCfa = habituels.length * HEURES_PAR_JOUR_CFA;
        const arrondi = (x) => Math.round(x * 10) / 10;

        // --- Referentiel : ce qui a deja ete pratique, et ce qui manque ---
        const faites = new Map(
          (pratiquePar.get(b.id) || []).map((r) => [r.service_id, r.n])
        );
        const referentiel = catalogue.rows.map((s2) => ({
          id: s2.id,
          name: s2.name,
          n: faites.get(s2.id) || 0,
        }));

        // --- Progression : premier et dernier mois renseignes ---
        const mois = (progressionPar.get(b.id) || [])
          .map((r) => ({ mois: r.mois, rdv_jour: Number(r.rdv_jour) }));

        const fid = fidelitePar.get(b.id);

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
          heures: {
            salon: arrondi(salonNet),
            cfa: heuresCfa,
            total: arrondi(salonNet + heuresCfa),
            contrat: CONTRAT_HEBDO,
            jours_salon: joursSalon,
          },
          referentiel,
          progression: mois,
          fidelite: fid ? { taux: fid.taux, visites: fid.visites } : null,
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
