const db = require('../config/database');
const logger = require('../utils/logger');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);

const BACKUP_TABLES = [
  'salons', 'barbers', 'services', 'barber_services',
  'schedules', 'schedule_overrides',
  'clients', 'client_salons', 'bookings',
  'blocked_slots', 'guest_assignments',
  'payments', 'register_closings',
  'products', 'product_sales', 'gift_cards',
  'waitlist', 'campaigns', 'automation_triggers',
];

const KEEP_DAYS = 7;

/**
 * Daily full backup — dumps all critical tables to _backups table (gzipped JSON).
 * Keeps last 7 days. Downloadable from dashboard Santé Système.
 * Runs at 04:00 daily in production.
 */
async function dailyBackupSnapshot() {
  try {
    // Ensure _backups table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS _backups (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        tables_count INTEGER NOT NULL,
        rows_count INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        data BYTEA NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Dump all tables
    const backup = { generated_at: new Date().toISOString(), version: '2.0', tables: {} };
    let totalRows = 0;

    for (const table of BACKUP_TABLES) {
      try {
        const { rows } = await db.query(`SELECT * FROM ${table}`);
        backup.tables[table] = { count: rows.length, rows };
        totalRows += rows.length;
      } catch (err) {
        backup.tables[table] = { count: 0, rows: [], error: err.message };
      }
    }

    // Compress with gzip
    const jsonStr = JSON.stringify(backup);
    const compressed = await gzip(Buffer.from(jsonStr, 'utf8'));

    // Upsert today's backup
    const today = new Date().toISOString().slice(0, 10);
    await db.query(
      `INSERT INTO _backups (date, tables_count, rows_count, size_bytes, data)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (date) DO UPDATE SET
         tables_count = $2, rows_count = $3, size_bytes = $4, data = $5, created_at = NOW()`,
      [today, BACKUP_TABLES.length, totalRows, compressed.length, compressed]
    );

    // Cleanup old backups
    await db.query(
      `DELETE FROM _backups WHERE date < (CURRENT_DATE - $1 * INTERVAL '1 day')`,
      [KEEP_DAYS]
    );

    const sizeMB = (compressed.length / 1024 / 1024).toFixed(2);
    logger.info(`=== DAILY BACKUP === ${totalRows} rows across ${BACKUP_TABLES.length} tables (${sizeMB} MB compressed)`, {
      date: today,
      tables: BACKUP_TABLES.length,
      rows: totalRows,
      sizeBytes: compressed.length,
    });
  } catch (err) {
    logger.error('Daily backup failed', { error: err.message });
  }
}

module.exports = { dailyBackupSnapshot };
