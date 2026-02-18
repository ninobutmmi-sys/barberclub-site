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
    refreshExpiresIn: '7d',
    refreshExpiresMs: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  },
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5500')
    .split(',')
    .map((s) => s.trim()),
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.EMAIL_FROM || 'BarberClub <noreply@barberclub.fr>',
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
  },
  salon: {
    name: process.env.SALON_NAME || 'BarberClub Meylan',
    address: process.env.SALON_ADDRESS || '26 Av. du Grésivaudan, 38700 Corenc',
    phone: process.env.SALON_PHONE || '',
    googleReviewUrl: process.env.GOOGLE_REVIEW_URL || '',
  },
};
