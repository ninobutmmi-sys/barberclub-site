// Les coupes de Daryl a Meylan passent a zero. Reversible : remettre
// custom_price a NULL rend les prix de la prestation.
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const DARYL = '4dbd67aa-1e1f-408c-9a75-47fa42df2832';
(async () => {
  const avant = await pool.query(`
    SELECT s.name, s.price, bs.custom_price FROM barber_services bs
    JOIN services s ON s.id = bs.service_id WHERE bs.barber_id = $1 ORDER BY s.sort_order`, [DARYL]);
  console.log('AVANT :'); console.table(avant.rows.map(r => ({ prestation: r.name.slice(0,40), prix: (r.price/100)+' €', prix_daryl: r.custom_price === null ? '(prix normal)' : (r.custom_price/100)+' €' })));

  const r = await pool.query(`UPDATE barber_services SET custom_price = 0 WHERE barber_id = $1 RETURNING service_id`, [DARYL]);
  console.log(`\n${r.rowCount} prestations passees a 0 €`);

  const apres = await pool.query(`
    SELECT s.name, s.price, bs.custom_price FROM barber_services bs
    JOIN services s ON s.id = bs.service_id WHERE bs.barber_id = $1 ORDER BY s.sort_order`, [DARYL]);
  console.log('APRES :'); console.table(apres.rows.map(r => ({ prestation: r.name.slice(0,40), prix_catalogue: (r.price/100)+' €', prix_daryl: (r.custom_price/100)+' €' })));

  const autres = await pool.query(`SELECT COUNT(*)::int n FROM barber_services WHERE custom_price IS NOT NULL AND barber_id <> $1`, [DARYL]);
  console.log(`\nAucun autre barbier touche : ${autres.rows[0].n} ligne(s) avec un prix personnalise ailleurs`);
  await pool.end();
})();
