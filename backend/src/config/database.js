const { Pool, types } = require('pg');
const config = require('./env');
const logger = require('../utils/logger');

// Return DATE columns as plain strings ('YYYY-MM-DD') instead of JS Date objects.
// Default pg behavior creates Date at local midnight, which JSON-serializes to the
// previous day in UTC for UTC+ timezones (e.g. '2026-02-18T23:00:00.000Z' for Feb 19 CET).
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Log connection events
pool.on('error', (err) => {
  logger.error('Unexpected database pool error', { error: err.message });
});

pool.on('connect', () => {
  logger.debug('New database connection established');
});

/**
 * Execute a single query with parameterized values
 * @param {string} text - SQL query with $1, $2... placeholders
 * @param {Array} params - Parameter values
 * @returns {Promise<object>} Query result
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Query executed', { text: text.substring(0, 80), duration, rows: result.rowCount });
    return result;
  } catch (error) {
    logger.error('Query failed', { text: text.substring(0, 80), error: error.message });
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 * IMPORTANT: Always release the client in a finally block
 * @returns {Promise<object>} Pool client
 */
async function getClient() {
  const client = await pool.connect();
  return client;
}

/**
 * Execute a function within a database transaction
 * Automatically handles BEGIN, COMMIT, ROLLBACK
 * @param {Function} fn - Async function receiving (client) as argument
 * @returns {Promise<any>} Result of fn
 */
async function transaction(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Health check: verify database connection
 */
async function healthCheck() {
  try {
    const result = await query('SELECT NOW() as now');
    return { ok: true, timestamp: result.rows[0].now };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { query, getClient, transaction, healthCheck, pool };
