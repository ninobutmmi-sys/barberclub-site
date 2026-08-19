/**
 * Répare les mobiles français amputés de leur 0 : `+6XXXXXXXX` → `+336XXXXXXXX`.
 *
 *   node scripts/repair-phones.js            # simulation, n'écrit rien
 *   node scripts/repair-phones.js --appliquer
 *
 * Même logique que la migration 069, mais rejouable à la demande. Elle existe
 * parce qu'un processus non identifié, connecté depuis le réseau interne
 * Railway (100.64.0.x), a défait 115 des 402 réparations le 2026-08-19 entre
 * 16h28 et 16h38, en réécrivant des lignes clients entières avec d'anciennes
 * valeurs. Tant que ce processus n'est pas identifié, la réparation peut être
 * à refaire ; autant qu'elle tienne en une commande.
 *
 * Les SMS partent de toute façon : services/notification répare le numéro à
 * l'envoi. Ce script remet la BASE d'aplomb, il ne débloque pas d'envoi.
 *
 * Sûr : un vrai numéro étranger en +6X/+7X compte au moins 10 chiffres après
 * le « + ». On ne touche qu'aux 9 chiffres exactement.
 * Les fiches dont la version corrigée existe déjà ailleurs sont laissées :
 * ce sont deux enregistrements de la même personne, la fusion se décide à la
 * main (contrainte UNIQUE clients_phone_key, sans filtre sur deleted_at).
 */

require('dotenv').config();
const { Pool } = require('pg');

const APPLIQUER = process.argv.includes('--appliquer');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

const CIBLE = "c.phone ~ '^\\+[67][0-9]{8}$' AND c.deleted_at IS NULL";
const SANS_COLLISION = `NOT EXISTS (
  SELECT 1 FROM clients d
  WHERE d.phone = '+33' || substring(c.phone FROM 2) AND d.id <> c.id
)`;

(async () => {
  const etat = await pool.query(`
    SELECT count(*) FILTER (WHERE ${SANS_COLLISION})::int reparables,
           count(*) FILTER (WHERE NOT (${SANS_COLLISION}))::int collisions
    FROM clients c WHERE ${CIBLE}`);
  const { reparables, collisions } = etat.rows[0];

  console.log(`À réparer   : ${reparables}`);
  console.log(`Collisions  : ${collisions} (doublons de personnes, laissés intacts)`);

  if (!APPLIQUER) {
    console.log('\nSimulation. Relancez avec --appliquer pour écrire.');
    await pool.end();
    return;
  }

  const r = await pool.query(`
    UPDATE clients c SET phone = '+33' || substring(c.phone FROM 2)
    WHERE ${CIBLE} AND ${SANS_COLLISION}`);
  console.log(`\n${r.rowCount} numéro(s) réparé(s).`);

  // Relecture depuis une connexion NEUVE : c'est ainsi qu'on a vu, le
  // 2026-07-28, que des écritures annoncées comme validées n'avaient pas tenu.
  await pool.end();
  const verif = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  const apres = await verif.query(`SELECT count(*)::int n FROM clients c WHERE ${CIBLE}`);
  console.log(`Vérification (connexion neuve) : ${apres.rows[0].n} cassé(s) restant(s).`);
  if (apres.rows[0].n > collisions) {
    console.log('⚠️  Plus de restants que de collisions : quelque chose a défait la réparation.');
  }
  await verif.end();
})().catch((e) => {
  console.error('Échec :', e.message);
  process.exit(1);
});
