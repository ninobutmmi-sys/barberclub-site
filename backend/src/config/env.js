require('dotenv').config();

// Validate required environment variables at startup
const required = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: '15m',
    refreshExpiresIn: '90d',
    refreshExpiresMs: 90 * 24 * 60 * 60 * 1000, // 90 days in ms
  },
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5500,http://localhost:5174')
    .split(',')
    .map((s) => s.trim()),
  brevo: {
    apiKey: process.env.BREVO_API_KEY || '',
    senderEmail: process.env.BREVO_SENDER_EMAIL || 'noreply@barberclub-grenoble.fr',
    senderName: process.env.BREVO_SENDER_NAME || 'BarberClub Meylan',
    smsSender: process.env.BREVO_SMS_SENDER || 'BARBERCLUB',
  },
  siteUrl: process.env.SITE_URL || 'https://barberclub-grenoble.fr',
  apiUrl: process.env.API_URL || `http://localhost:${parseInt(process.env.PORT, 10) || 3000}`,
  salon: {
    name: process.env.SALON_NAME || 'BarberClub Meylan',
    address: process.env.SALON_ADDRESS || '26 Av. du Grésivaudan, 38700 Corenc',
    phone: process.env.SALON_PHONE || '',
    googleReviewUrl: process.env.GOOGLE_REVIEW_URL || '',
  },
};
