#!/usr/bin/env node

/**
 * Migration runner for BarberClub backend.
 *
 * Usage: node database/migrate.js        (from backend/)
 *
 * - Creates schema_migrations table if missing
 * - Applies all pending NNN_*.sql files in order
 * - Each migration runs in its own transaction
 * - Stops on first failure
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load .env from backend root
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set. Check your .env file.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version   INT PRIMARY KEY,
      name      TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function getMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{3}_.*\.sql$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.substring(0, 3), 10);
      const numB = parseInt(b.substring(0, 3), 10);
      return numA - numB;
    });
  return files;
}

function parseVersion(filename) {
  return parseInt(filename.substring(0, 3), 10);
}

async function getAppliedVersions(client) {
  const result = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(result.rows.map(r => r.version));
}

async function applyMigration(pool, version, name, sql) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
      [version, name]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function run() {
  console.log('BarberClub Migration Runner');
  console.log('==========================\n');

  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedVersions(client);
    console.log(`Already applied: ${applied.size} migration(s)`);
  } finally {
    client.release();
  }

  // Re-fetch applied versions (client released)
  const checkClient = await pool.connect();
  let applied;
  try {
    applied = await getAppliedVersions(checkClient);
  } finally {
    checkClient.release();
  }

  const files = getMigrationFiles();
  const pending = files.filter(f => !applied.has(parseVersion(f)));

  if (pending.length === 0) {
    console.log('No pending migrations. Database is up to date.\n');
    await pool.end();
    return;
  }

  console.log(`Pending: ${pending.length} migration(s)\n`);

  for (const file of pending) {
    const version = parseVersion(file);
    const name = file.replace(/\.sql$/, '');
    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    process.stdout.write(`  Applying ${file} ... `);

    try {
      await applyMigration(pool, version, name, sql);
      console.log('OK');
    } catch (error) {
      console.log('FAILED');
      console.error(`\n  Error in migration ${file}:`);
      console.error(`  ${error.message}\n`);
      console.error('Migration stopped. Fix the issue and re-run.');
      await pool.end();
      process.exit(1);
    }
  }

  console.log(`\nDone. Applied ${pending.length} migration(s) successfully.`);
  await pool.end();
}

run().catch(err => {
  console.error('Unexpected error:', err);
  pool.end().then(() => process.exit(1));
});
