const db = require('../config/database');
const logger = require('../utils/logger');
const zlib = require('zlib');
const crypto = require('crypto');
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

// R2 config (S3-compatible)
const R2_ENDPOINT = process.env.R2_ENDPOINT || 'https://242049d739de8adc0cab491404e83b80.r2.cloudflarestorage.com';
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET || 'barberclub-backups';

/**
 * Upload buffer to Cloudflare R2 using S3-compatible API (AWS Signature V4).
 * No external dependency — uses native crypto + fetch.
 */
async function uploadToR2(key, body) {
  if (!R2_ACCESS_KEY || !R2_SECRET_KEY) {
    logger.warn('R2 credentials not configured — skipping cloud backup');
    return false;
  }

  const url = new URL(`/${R2_BUCKET}/${key}`, R2_ENDPOINT);
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8);
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z');
  const region = 'auto';
  const service = 's3';
  const contentHash = crypto.createHash('sha256').update(body).digest('hex');

  const headers = {
    'Host': url.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': contentHash,
    'Content-Type': 'application/gzip',
    'Content-Length': String(body.length),
  };

  // Canonical request
  const signedHeaders = Object.keys(headers).map(k => k.toLowerCase()).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(k => `${k.toLowerCase()}:${headers[k]}`).join('\n') + '\n';
  const canonicalRequest = [
    'PUT', url.pathname, '', canonicalHeaders, signedHeaders, contentHash,
  ].join('\n');

  // String to sign
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  // Signing key
  function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }
  const kDate = hmac(`AWS4${R2_SECRET_KEY}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url.toString(), { method: 'PUT', headers, body });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`R2 upload failed (${response.status}): ${err.slice(0, 200)}`);
  }
  return true;
}

/**
 * Daily full backup — dumps all critical tables to _backups table (gzipped JSON)
 * + uploads to Cloudflare R2 for off-site safety.
 * Keeps last 7 days in DB. R2 keeps 30 days.
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
    const today = new Date().toISOString().slice(0, 10);

    // 1. Store in PostgreSQL (local backup)
    await db.query(
      `INSERT INTO _backups (date, tables_count, rows_count, size_bytes, data)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (date) DO UPDATE SET
         tables_count = $2, rows_count = $3, size_bytes = $4, data = $5, created_at = NOW()`,
      [today, BACKUP_TABLES.length, totalRows, compressed.length, compressed]
    );

    // Cleanup old DB backups
    await db.query(
      `DELETE FROM _backups WHERE date < (CURRENT_DATE - $1 * INTERVAL '1 day')`,
      [KEEP_DAYS]
    );

    // 2. Upload to Cloudflare R2 (off-site backup)
    let r2ok = false;
    try {
      r2ok = await uploadToR2(`backups/${today}.json.gz`, compressed);
    } catch (err) {
      logger.error('R2 backup upload failed', { error: err.message });
    }

    const sizeMB = (compressed.length / 1024 / 1024).toFixed(2);
    logger.info(`=== DAILY BACKUP === ${totalRows} rows, ${BACKUP_TABLES.length} tables, ${sizeMB} MB | DB: OK | R2: ${r2ok ? 'OK' : 'SKIP'}`, {
      date: today, tables: BACKUP_TABLES.length, rows: totalRows,
      sizeBytes: compressed.length, r2: r2ok,
    });
  } catch (err) {
    logger.error('Daily backup failed', { error: err.message });
  }
}

module.exports = { dailyBackupSnapshot };
