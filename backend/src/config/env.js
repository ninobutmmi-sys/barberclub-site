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

// Warn about critical optional vars in production
if (process.env.NODE_ENV === 'production') {
  if (!process.env.BREVO_API_KEY) {
    console.error('WARNING: BREVO_API_KEY is not set — all emails and SMS will silently fail!');
  }
  if (!process.env.SITE_URL) {
    console.error('WARNING: SITE_URL is not set — email links will point to localhost!');
  }
  if (!process.env.API_URL) {
    console.error('WARNING: API_URL is not set — SMS links will point to localhost!');
  }
}

// ============================================
// Salon configuration (multi-salon support)
// ============================================
const SALONS = {
  meylan: {
    name: process.env.SALON_NAME || 'BarberClub Meylan',
    address: process.env.SALON_ADDRESS || '26 Av. du Grésivaudan, 38700 Corenc',
    phone: process.env.SALON_PHONE || '04 58 28 21 75',
    googleReviewUrl: process.env.GOOGLE_REVIEW_URL || '',
    bookingPath: '/pages/meylan',
    mapsUrl: 'https://maps.google.com/?q=26+Av+du+Gr%C3%A9sivaudan+38700+Corenc',
    heroImage: '/assets/images/salons/meylan/salon-meylan-interieur.jpg',
    brevo: {
      apiKey: process.env.BREVO_API_KEY || '',
      senderEmail: process.env.BREVO_SENDER_EMAIL || 'noreply@barberclub-grenoble.fr',
      senderName: process.env.BREVO_SENDER_NAME || 'BarberClub Meylan',
      smsSender: process.env.BREVO_SMS_SENDER || 'BARBERCLUB',
    },
  },
  grenoble: {
    name: process.env.SALON_GRENOBLE_NAME || 'BarberClub Grenoble',
    address: process.env.SALON_GRENOBLE_ADDRESS || '5 Rue Clôt Bey, 38000 Grenoble',
    phone: process.env.SALON_GRENOBLE_PHONE || '09 56 30 93 86',
    googleReviewUrl: process.env.GOOGLE_REVIEW_URL_GRENOBLE || '',
    bookingPath: '/pages/grenoble',
    mapsUrl: 'https://maps.google.com/?q=5+Rue+Cl%C3%B4t+Bey+38000+Grenoble',
    heroImage: '/assets/images/salons/grenoble/salon-grenoble-interieur.jpg',
    brevo: {
      apiKey: process.env.BREVO_API_KEY_GRENOBLE || '',
      senderEmail: process.env.BREVO_SENDER_EMAIL_GRENOBLE || 'noreply@barberclub-grenoble.fr',
      senderName: process.env.BREVO_SENDER_NAME_GRENOBLE || 'BarberClub Grenoble',
      smsSender: process.env.BREVO_SMS_SENDER_GRENOBLE || 'BARBERCLUB',
    },
  },
};

function getSalonConfig(salonId) {
  return SALONS[salonId] || SALONS.meylan;
}

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: '15m',         // clients
    barberAccessExpiresIn: '7d',    // barbers — reconnexion 1x/semaine
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
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: `mailto:${process.env.BREVO_SENDER_EMAIL || 'noreply@barberclub-grenoble.fr'}`,
  },
  getSalonConfig,
  SALONS,
};
