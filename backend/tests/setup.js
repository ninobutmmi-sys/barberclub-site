/**
 * Test setup — runs against the real Supabase DB.
 * Uses @test.barberclub.fr emails so test data is easy to identify and clean.
 * BREVO_API_KEY is empty in test → no emails/SMS sent.
 */
const db = require('../src/config/database');

// Known seed data IDs (from seed.sql)
const LUCAS_ID = 'b0000000-0000-0000-0000-000000000001';
const JULIEN_ID = 'b0000000-0000-0000-0000-000000000002';
const COUPE_HOMME_ID = 'a0000000-0000-0000-0000-000000000001'; // 30min, 2700 cents

// Test-specific data markers
const TEST_EMAIL_DOMAIN = '@test.barberclub.fr';
const TEST_PHONE_PREFIX = '+33600000';

module.exports = {
  LUCAS_ID,
  JULIEN_ID,
  COUPE_HOMME_ID,
  TEST_EMAIL_DOMAIN,
  TEST_PHONE_PREFIX,
  db,
};
