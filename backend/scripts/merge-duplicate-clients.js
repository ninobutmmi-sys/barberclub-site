#!/usr/bin/env node
/**
 * Fusion des fiches clients en doublon.
 *
 * Un même client peut exister plusieurs fois parce que son numéro a été saisi
 * sous plusieurs formes : 0612345678, +33612345678, ou +612345678 (le 0 mangé
 * par l'import Timify de mars 2026). La contrainte UNIQUE sur clients.phone ne
 * les voit pas : ce sont des chaînes différentes.
 *
 * Usage :
 *   node scripts/merge-duplicate-clients.js                 # analyse seule (aucune écriture)
 *   node scripts/merge-duplicate-clients.js --apply         # fusionne les groupes sûrs
 *   node scripts/merge-duplicate-clients.js --apply --limit 20
 *
 * Les groupes classés "a-revoir" ne sont JAMAIS fusionnés automatiquement : un
 * numéro partagé par deux prénoms différents est le plus souvent une famille
 * (Paul et Karen Berrux), pas un doublon.
 *
 * Écritures en autocommit statement par statement, jamais en une grosse
 * transaction : cf. incident du 2026-07-02 (synchronous_commit=off) où un COMMIT
 * unique n'avait persisté que partiellement.
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

if (!process.env.DATABASE_URL) {
  console.error('ERREUR : DATABASE_URL absent. Vérifie backend/.env');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

// Même réglage SSL que database/migrate.js, pour se connecter à la même base
// de la même façon (le proxy Railway se joint en clair depuis un poste de dev).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Normalisation ──────────────────────────────────────────────────────────

/** Même règle que repairTruncatedFrenchMobile + formatPhoneInternational. */
function toE164(phone) {
  if (!phone) return null;
  const c = phone.replace(/[\s.-]/g, '');
  if (/^0[1-9]\d{8}$/.test(c)) return '+33' + c.slice(1);
  if (/^0033[1-9]\d{8}$/.test(c)) return '+33' + c.slice(4);
  if (/^\+[67]\d{8}$/.test(c)) return '+33' + c.slice(1); // 0 mangé à l'import
  return c;
}

/** minuscules, sans accents, sans ponctuation, tokens triés → « Virga Maxence » == « Maxence Virga ». */
function nameKey(first, last) {
  return [first, last]
    .map((s) => (s || ''))
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Classe un groupe de fiches partageant le même numéro normalisé.
 *  identique  → clés de nom strictement égales
 *  variante   → égales après normalisation, ou écart de frappe ≤ 2 sur un nom long,
 *               ou une fiche dont le nom est contenu dans l'autre (« bucari » ⊂ « remy bucari »)
 *  a-revoir   → tout le reste (familles, homonymes partiels, noms sans rapport)
 */
function classify(rows) {
  const keys = [...new Set(rows.map((r) => nameKey(r.first_name, r.last_name)))];
  if (keys.length === 1) return keys[0] === '' ? 'a-revoir' : 'identique';
  if (keys.some((k) => k === '')) return 'a-revoir'; // fiche sans nom : on ne devine pas

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const [a, b] = [keys[i], keys[j]];
      const contained = a.split(' ').every((t) => b.includes(t)) || b.split(' ').every((t) => a.includes(t));
      const d = levenshtein(a, b);
      const maxLen = Math.max(a.length, b.length);
      const proche = d <= 2 && maxLen >= 8;
      if (!contained && !proche) return 'a-revoir';
    }
  }
  return 'variante';
}

/** La fiche à conserver : celle qui porte le plus d'historique. */
function pickKeeper(rows) {
  return rows.slice().sort((a, b) =>
    (b.nb_rdv - a.nb_rdv) ||
    (Number(b.has_account) - Number(a.has_account)) ||
    ((b.phone.startsWith('+33') ? 1 : 0) - (a.phone.startsWith('+33') ? 1 : 0)) ||
    (new Date(a.created_at) - new Date(b.created_at))
  )[0];
}

// ── Fusion ─────────────────────────────────────────────────────────────────

const REPOINT = [
  ['bookings', 'client_id'],
  ['product_sales', 'client_id'],
  ['gift_cards', 'buyer_client_id'],
  ['waitlist', 'client_id'],
  ['client_photos', 'client_id'],
];

async function mergeGroup(keeper, losers) {
  for (const loser of losers) {
    for (const [table, col] of REPOINT) {
      await pool.query(`UPDATE ${table} SET ${col} = $1 WHERE ${col} = $2`, [keeper.id, loser.id]);
    }
    await pool.query(
      `UPDATE refresh_tokens SET user_id = $1 WHERE user_id = $2 AND user_type = 'client'`,
      [keeper.id, loser.id]
    );
    // Le keeper récupère les champs qu'il n'a pas (email, compte, notes).
    await pool.query(
      `UPDATE clients k SET
         email         = COALESCE(NULLIF(k.email, ''), l.email),
         password_hash = COALESCE(k.password_hash, l.password_hash),
         has_account   = k.has_account OR l.has_account,
         notes         = CASE WHEN COALESCE(l.notes,'') = '' THEN k.notes
                              WHEN COALESCE(k.notes,'') = '' THEN l.notes
                              ELSE k.notes || E'\\n' || l.notes END
       FROM clients l WHERE k.id = $1 AND l.id = $2`,
      [keeper.id, loser.id]
    );
    // client_salons est en ON DELETE CASCADE : reprendre les liens avant de supprimer.
    await pool.query(
      `INSERT INTO client_salons (client_id, salon_id, created_at)
       SELECT $1, salon_id, created_at FROM client_salons WHERE client_id = $2
       ON CONFLICT DO NOTHING`,
      [keeper.id, loser.id]
    );
    await pool.query('DELETE FROM client_salons WHERE client_id = $1', [loser.id]);
    await pool.query('DELETE FROM clients WHERE id = $1', [loser.id]);
  }
}

// ── Programme ──────────────────────────────────────────────────────────────

async function main() {
  const { rows } = await pool.query(`
    SELECT c.id, c.phone, c.first_name, c.last_name, c.email, c.has_account, c.created_at,
           (SELECT count(*) FROM bookings b WHERE b.client_id = c.id)::int AS nb_rdv
    FROM clients c
    WHERE c.phone IS NOT NULL AND c.phone NOT LIKE 'DEL_%' AND c.deleted_at IS NULL
  `);

  const groups = new Map();
  for (const r of rows) {
    const key = toE164(r.phone);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const buckets = { identique: [], variante: [], 'a-revoir': [] };
  for (const [e164, members] of groups) {
    if (members.length < 2) continue;
    buckets[classify(members)].push({ e164, members });
  }

  const fiches = (b) => b.reduce((n, g) => n + g.members.length - 1, 0);
  console.log(`\nFiches analysées : ${rows.length}`);
  console.log(`Groupes en doublon : ${buckets.identique.length + buckets.variante.length + buckets['a-revoir'].length}\n`);
  console.log(`  identique  ${String(buckets.identique.length).padStart(4)} groupes → ${fiches(buckets.identique)} fiches à supprimer`);
  console.log(`  variante   ${String(buckets.variante.length).padStart(4)} groupes → ${fiches(buckets.variante)} fiches à supprimer`);
  console.log(`  a-revoir   ${String(buckets['a-revoir'].length).padStart(4)} groupes → ${fiches(buckets['a-revoir'])} fiches, NON fusionnées\n`);

  console.log('— Échantillon "variante" (fusionné) —');
  for (const g of buckets.variante.slice(0, 8)) {
    console.log('   ' + g.members.map((m) => `${m.first_name || ''} ${m.last_name || ''} [${m.nb_rdv} rdv]`.trim()).join('  |  '));
  }
  console.log('\n— Échantillon "a-revoir" (laissé tel quel) —');
  for (const g of buckets['a-revoir'].slice(0, 8)) {
    console.log('   ' + g.members.map((m) => `${m.first_name || ''} ${m.last_name || ''} [${m.nb_rdv} rdv]`.trim()).join('  |  '));
  }

  if (!APPLY) {
    console.log('\nAnalyse seule — aucune écriture. Relancer avec --apply pour fusionner.');
    await pool.end();
    return;
  }

  const todo = [...buckets.identique, ...buckets.variante].slice(0, LIMIT);
  console.log(`\nFusion de ${todo.length} groupes...`);
  let done = 0, supprimees = 0;
  for (const g of todo) {
    const keeper = pickKeeper(g.members);
    const losers = g.members.filter((m) => m.id !== keeper.id);
    try {
      await mergeGroup(keeper, losers);
      done++; supprimees += losers.length;
      if (done % 50 === 0) console.log(`  ${done}/${todo.length}`);
    } catch (err) {
      console.error(`  ÉCHEC ${g.e164} : ${err.message}`);
    }
  }
  console.log(`\n${done} groupes fusionnés, ${supprimees} fiches supprimées.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
