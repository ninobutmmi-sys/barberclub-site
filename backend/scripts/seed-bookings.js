#!/usr/bin/env node
/**
 * Script de seed : remplit le planning avec ~190 RDV de test
 * Semaine du 16-21 février 2026 (Lun-Sam)
 * 2 barbers × 6 jours × ~16 créneaux = ~192 bookings
 *
 * Exécution séquentielle pour éviter les conflits de créneaux
 */

const BASE_URL = 'http://localhost:3000/api';

// ── Données ──────────────────────────────────────────────

const BARBERS = [
  { id: 'b0000000-0000-0000-0000-000000000001', name: 'Lucas' },
  { id: 'b0000000-0000-0000-0000-000000000002', name: 'Julien' },
];

// Services partagés par les 2 barbers (avec poids pour distribution réaliste)
const SERVICES = [
  { id: 'a0000000-0000-0000-0000-000000000001', name: 'Coupe Homme', duration: 30, weight: 5 },
  { id: 'a0000000-0000-0000-0000-000000000002', name: 'Coupe+Contours', duration: 30, weight: 3 },
  { id: 'a0000000-0000-0000-0000-000000000003', name: 'Coupe+Barbe', duration: 30, weight: 3 },
  { id: 'a0000000-0000-0000-0000-000000000006', name: 'Luxe', duration: 40, weight: 1 },
  { id: 'a0000000-0000-0000-0000-000000000007', name: 'Barbe', duration: 20, weight: 2 },
  { id: 'a0000000-0000-0000-0000-000000000008', name: 'Barbe+Soin', duration: 30, weight: 1 },
];

// 30 clients test réalistes
const CLIENTS = [
  { first: 'Thomas', last: 'Martin', phone: '0612345001' },
  { first: 'Lucas', last: 'Bernard', phone: '0612345002' },
  { first: 'Hugo', last: 'Dubois', phone: '0612345003' },
  { first: 'Arthur', last: 'Moreau', phone: '0612345004' },
  { first: 'Nathan', last: 'Laurent', phone: '0612345005' },
  { first: 'Léo', last: 'Simon', phone: '0612345006' },
  { first: 'Gabriel', last: 'Michel', phone: '0612345007' },
  { first: 'Jules', last: 'Lefebvre', phone: '0612345008' },
  { first: 'Raphaël', last: 'Leroy', phone: '0612345009' },
  { first: 'Louis', last: 'Roux', phone: '0612345010' },
  { first: 'Adam', last: 'David', phone: '0612345011' },
  { first: 'Ethan', last: 'Bertrand', phone: '0612345012' },
  { first: 'Paul', last: 'Morel', phone: '0612345013' },
  { first: 'Sacha', last: 'Fournier', phone: '0612345014' },
  { first: 'Maxime', last: 'Girard', phone: '0612345015' },
  { first: 'Antoine', last: 'Bonnet', phone: '0612345016' },
  { first: 'Mathis', last: 'Dupont', phone: '0612345017' },
  { first: 'Théo', last: 'Lambert', phone: '0612345018' },
  { first: 'Noah', last: 'Fontaine', phone: '0612345019' },
  { first: 'Liam', last: 'Rousseau', phone: '0612345020' },
  { first: 'Enzo', last: 'Vincent', phone: '0612345021' },
  { first: 'Mohamed', last: 'Benali', phone: '0612345022' },
  { first: 'Karim', last: 'Amrani', phone: '0612345023' },
  { first: 'Youssef', last: 'Haddad', phone: '0612345024' },
  { first: 'Pierre', last: 'Gauthier', phone: '0612345025' },
  { first: 'Clément', last: 'Perrin', phone: '0612345026' },
  { first: 'Alexandre', last: 'Robin', phone: '0612345027' },
  { first: 'Victor', last: 'Masson', phone: '0612345028' },
  { first: 'Romain', last: 'Muller', phone: '0612345029' },
  { first: 'Dylan', last: 'Chevalier', phone: '0612345030' },
];

const DATES = [
  '2026-02-16', // Lundi
  '2026-02-17', // Mardi
  '2026-02-18', // Mercredi
  '2026-02-19', // Jeudi
  '2026-02-20', // Vendredi
  '2026-02-21', // Samedi
];

const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

// ── Helpers ──────────────────────────────────────────────

function pickWeightedService() {
  const totalWeight = SERVICES.reduce((sum, s) => sum + s.weight, 0);
  let r = Math.random() * totalWeight;
  for (const s of SERVICES) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return SERVICES[0];
}

function timeToMin(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minToTime(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function generateDaySlots(existingForBarber) {
  // Construire liste des intervalles occupés [startMin, endMin]
  const occupied = existingForBarber.map(b => [
    timeToMin(b.start_time),
    timeToMin(b.end_time),
  ]);

  const slots = [];
  let current = 9 * 60; // 09:00
  const dayEnd = 19 * 60; // 19:00

  while (current < 18 * 60 + 30) { // stop generating at 18:30
    const service = pickWeightedService();
    const endMin = current + service.duration;

    if (endMin > dayEnd) break;

    // Vérifier conflit avec créneaux existants
    const hasConflict = occupied.some(
      ([os, oe]) => current < oe && endMin > os
    );

    if (!hasConflict) {
      slots.push({ startTime: minToTime(current), service });
      occupied.push([current, endMin]); // Marquer comme pris
      // Gap aléatoire (réalisme)
      const gap = Math.random() < 0.12 ? 10 : 0;
      current = endMin + gap;
    } else {
      // Avancer de 10 min et réessayer
      current += 10;
    }
  }
  return slots;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractBookings(response) {
  if (Array.isArray(response)) return response;
  if (response.data && Array.isArray(response.data)) return response.data;
  if (response.bookings && Array.isArray(response.bookings)) return response.bookings;
  return [];
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log('=== Seed Planning — Semaine 16-21 Fev 2026 ===\n');
  console.log('Connexion admin...');

  // 1. Login
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@admin.com',
      password: 'admin',
      type: 'barber',
    }),
  });

  if (!loginRes.ok) {
    console.error('Login failed:', await loginRes.text());
    process.exit(1);
  }

  const { access_token } = await loginRes.json();
  console.log('OK - Connecte\n');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${access_token}`,
  };

  // 2. Récupérer bookings existants par jour et par barber
  console.log('Chargement des bookings existants...');
  const existingByBarberDate = {};
  for (const barber of BARBERS) {
    for (const date of DATES) {
      const key = `${barber.id}:${date}`;
      existingByBarberDate[key] = [];
    }
  }

  for (const date of DATES) {
    const res = await fetch(
      `${BASE_URL}/admin/bookings?from=${date}&to=${date}`,
      { headers }
    );
    const raw = await res.json();
    const dayBookings = extractBookings(raw);
    for (const b of dayBookings) {
      const key = `${b.barber_id}:${date}`;
      if (existingByBarberDate[key]) {
        existingByBarberDate[key].push(b);
      }
    }
  }

  const totalExisting = Object.values(existingByBarberDate).reduce((s, a) => s + a.length, 0);
  console.log(`Bookings existants: ${totalExisting}\n`);

  // 3. Générer les bookings
  const allBookings = [];
  let clientIdx = 0;

  for (const date of DATES) {
    const dayIdx = DATES.indexOf(date);
    for (const barber of BARBERS) {
      const key = `${barber.id}:${date}`;
      const existing = existingByBarberDate[key];
      const daySlots = generateDaySlots(existing);

      for (const slot of daySlots) {
        const client = CLIENTS[clientIdx % CLIENTS.length];
        clientIdx++;

        allBookings.push({
          barber_id: barber.id,
          barber_name: barber.name,
          service_id: slot.service.id,
          service_name: slot.service.name,
          date,
          day_name: DAY_NAMES[dayIdx],
          start_time: slot.startTime,
          first_name: client.first,
          last_name: client.last,
          phone: client.phone,
          email: `${client.first.toLowerCase()}.${client.last.toLowerCase()}@test.com`,
        });
      }
    }
  }

  console.log(`Bookings a creer: ${allBookings.length}`);
  console.log(`Total vise: ${allBookings.length + totalExisting}\n`);

  // 4. Créer séquentiellement (1 par 1, 350ms entre chaque)
  let created = 0;
  let errors = 0;
  let lastDay = '';
  const startTime = Date.now();

  for (let i = 0; i < allBookings.length; i++) {
    const b = allBookings[i];

    // Afficher header par jour
    if (b.date !== lastDay) {
      if (lastDay) console.log('');
      console.log(`--- ${b.day_name} ${b.date} ---`);
      lastDay = b.date;
    }

    const payload = {
      barber_id: b.barber_id,
      service_id: b.service_id,
      date: b.date,
      start_time: b.start_time,
      first_name: b.first_name,
      last_name: b.last_name,
      phone: b.phone,
      email: b.email,
    };

    try {
      const res = await fetch(`${BASE_URL}/admin/bookings`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        created++;
        process.stdout.write(`  + ${b.start_time} ${b.barber_name.padEnd(7)} ${b.first_name} ${b.last_name} (${b.service_name})\n`);
      } else {
        errors++;
        const err = await res.json();
        const msg = err.error || `HTTP ${res.status}`;
        // Rate limit? Attendre et réessayer
        if (res.status === 429) {
          console.log(`  ! Rate limited — pause 5s...`);
          await sleep(5000);
          // Retry
          const retry = await fetch(`${BASE_URL}/admin/bookings`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });
          if (retry.ok) {
            created++;
            errors--;
            process.stdout.write(`  + ${b.start_time} ${b.barber_name.padEnd(7)} ${b.first_name} ${b.last_name} (retry OK)\n`);
          } else {
            process.stdout.write(`  x ${b.start_time} ${b.barber_name.padEnd(7)} ${b.first_name}: ${msg}\n`);
          }
        } else {
          process.stdout.write(`  x ${b.start_time} ${b.barber_name.padEnd(7)} ${b.first_name}: ${msg}\n`);
        }
      }
    } catch (e) {
      errors++;
      process.stdout.write(`  x ${b.start_time} ${b.barber_name.padEnd(7)} ${b.first_name}: ${e.message}\n`);
    }

    // Délai entre requêtes : 350ms (= ~170 req/min, sous la limite de 200/min)
    if (i < allBookings.length - 1) {
      await sleep(350);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n');
  console.log('='.repeat(50));
  console.log(`  Crees:     ${created}`);
  console.log(`  Erreurs:   ${errors}`);
  console.log(`  Total:     ${created + totalExisting} (existants: ${totalExisting})`);
  console.log(`  Duree:     ${elapsed}s`);
  console.log('='.repeat(50));

  // 5. Vérification par jour
  console.log('\nVerification par jour:');
  let grandTotal = 0;
  for (let i = 0; i < DATES.length; i++) {
    const date = DATES[i];
    const res = await fetch(
      `${BASE_URL}/admin/bookings?from=${date}&to=${date}`,
      { headers }
    );
    const raw = await res.json();
    const dayBookings = extractBookings(raw);
    const lucasCount = dayBookings.filter(b => b.barber_id === BARBERS[0].id).length;
    const julienCount = dayBookings.filter(b => b.barber_id === BARBERS[1].id).length;
    grandTotal += dayBookings.length;
    console.log(`  ${DAY_NAMES[i]} ${date}: ${dayBookings.length} RDV (Lucas: ${lucasCount}, Julien: ${julienCount})`);
  }
  console.log(`  TOTAL: ${grandTotal} RDV`);

  // 6. Vérifier clients
  const clientsRes = await fetch(`${BASE_URL}/admin/clients?limit=100`, { headers });
  const clientsRaw = await clientsRes.json();
  const clients = clientsRaw.data || clientsRaw;
  console.log(`\nClients en base: ${Array.isArray(clients) ? clients.length : 'N/A'}`);

  console.log('\nSeed termine !');
}

main().catch(console.error);
