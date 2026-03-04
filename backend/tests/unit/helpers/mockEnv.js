const SALONS = {
  meylan: {
    name: 'BarberClub Meylan',
    address: '26 Av. du Grésivaudan, 38700 Corenc',
    phone: '+33000000000',
    googleReviewUrl: 'https://g.page/r/test',
    bookingPath: '/pages/meylan',
    mapsUrl: 'https://maps.google.com/?q=test',
    brevo: {
      apiKey: 'test-key',
      senderEmail: 'test@test.com',
      senderName: 'BarberClub Meylan',
      smsSender: 'BARBERCLUB',
    },
  },
  grenoble: {
    name: 'BarberClub Grenoble',
    address: '5 Rue Clôt Bey, 38000 Grenoble',
    phone: '09 56 30 93 86',
    googleReviewUrl: '',
    bookingPath: '/pages/grenoble',
    mapsUrl: 'https://maps.google.com/?q=grenoble',
    brevo: {
      apiKey: 'test-key-gre',
      senderEmail: 'test-gre@test.com',
      senderName: 'BarberClub Grenoble',
      smsSender: 'BARBERCLUB',
    },
  },
};

module.exports = {
  port: 3000,
  nodeEnv: 'test',
  databaseUrl: 'postgresql://test:test@localhost/test',
  jwt: {
    secret: 'test-jwt-secret',
    refreshSecret: 'test-refresh-secret',
    accessExpiresIn: '15m',
    refreshExpiresIn: '90d',
    refreshExpiresMs: 90 * 24 * 60 * 60 * 1000,
  },
  corsOrigins: ['http://localhost:5500', 'http://localhost:5174'],
  brevo: {
    apiKey: 'test-key',
    senderEmail: 'test@test.com',
    senderName: 'BarberClub Meylan',
    smsSender: 'BARBERCLUB',
  },
  siteUrl: 'https://barberclub-grenoble.fr',
  apiUrl: 'http://localhost:3000',
  salon: {
    name: 'BarberClub Meylan',
    address: '26 Av. du Grésivaudan, 38700 Corenc',
    phone: '+33000000000',
    googleReviewUrl: 'https://g.page/r/test',
  },
  getSalonConfig: (salonId) => SALONS[salonId] || SALONS.meylan,
  SALONS,
};
