// E2E tests for critical API flows
// Requires backend running on localhost:3000
// Run: npx playwright test

import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';

// Test data
const LUCAS_ID = 'b0000000-0000-0000-0000-000000000001';
const COUPE_HOMME_ID = 'a0000000-0000-0000-0000-000000000001';

function getNextWorkingDate(daysAhead = 14) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  const jsDay = date.getDay();
  // Lucas works Tue-Sat (not Mon=1, not Sun=0)
  if (jsDay === 0) date.setDate(date.getDate() + 2); // Sun → Tue
  if (jsDay === 1) date.setDate(date.getDate() + 1); // Mon → Tue
  return date.toISOString().slice(0, 10);
}

const testPhone = `06${Date.now().toString().slice(-8)}`;
const testEmail = `e2e-${Date.now()}@test.barberclub.fr`;

let bookingId;
let cancelToken;
let clientAccessToken;
let clientRefreshToken;

// ============================================
// Flow 1: Health check
// ============================================
test.describe('Health', () => {
  test('GET /api/health returns ok', async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  test('GET /api/health/ping returns pong', async ({ request }) => {
    const res = await request.get(`${API}/health/ping`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.message).toBe('pong');
  });
});

// ============================================
// Flow 2: Public booking endpoints
// ============================================
test.describe('Public Booking Flow', () => {
  test('GET /api/barbers returns active barbers', async ({ request }) => {
    const res = await request.get(`${API}/barbers`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty('id');
    expect(data[0]).toHaveProperty('name');
  });

  test('GET /api/services returns active services', async ({ request }) => {
    const res = await request.get(`${API}/services`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty('price');
    expect(data[0]).toHaveProperty('duration');
  });

  test('GET /api/availability returns slots', async ({ request }) => {
    const date = getNextWorkingDate();
    const res = await request.get(`${API}/availability?barber_id=${LUCAS_ID}&service_id=${COUPE_HOMME_ID}&date=${date}`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty('time');
  });

  test('POST /api/bookings creates a booking', async ({ request }) => {
    const date = getNextWorkingDate();
    const res = await request.post(`${API}/bookings`, {
      data: {
        barber_id: LUCAS_ID,
        service_id: COUPE_HOMME_ID,
        date,
        start_time: '15:00',
        first_name: 'E2ETest',
        last_name: 'Playwright',
        phone: testPhone,
        email: testEmail,
      },
    });
    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('cancel_token');
    expect(data.status).toBe('confirmed');
    bookingId = data.id;
    cancelToken = data.cancel_token;
  });

  test('GET /api/bookings/:id retrieves booking', async ({ request }) => {
    test.skip(!bookingId, 'No booking created');
    const res = await request.get(`${API}/bookings/${bookingId}?token=${cancelToken}`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(bookingId);
    expect(data.first_name).toBe('E2ETest');
  });

  test('POST /api/bookings/:id/cancel cancels booking', async ({ request }) => {
    test.skip(!bookingId, 'No booking created');
    const res = await request.post(`${API}/bookings/${bookingId}/cancel`, {
      data: { cancel_token: cancelToken },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('cancelled');
  });
});

// ============================================
// Flow 3: Client auth flow
// ============================================
test.describe('Client Auth Flow', () => {
  test('POST /api/auth/register creates client account', async ({ request }) => {
    const res = await request.post(`${API}/auth/register`, {
      data: {
        first_name: 'E2EClient',
        last_name: 'Test',
        phone: `07${Date.now().toString().slice(-8)}`,
        email: `e2e-client-${Date.now()}@test.barberclub.fr`,
        password: 'TestPassword123!',
      },
    });
    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty('access_token');
    expect(data).toHaveProperty('refresh_token');
    expect(data.user.type).toBe('client');
    clientAccessToken = data.access_token;
    clientRefreshToken = data.refresh_token;
  });

  test('GET /api/client/profile returns client profile', async ({ request }) => {
    test.skip(!clientAccessToken, 'No client token');
    const res = await request.get(`${API}/client/profile`, {
      headers: { Authorization: `Bearer ${clientAccessToken}` },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.first_name).toBe('E2EClient');
  });

  test('POST /api/auth/refresh returns new tokens', async ({ request }) => {
    test.skip(!clientRefreshToken, 'No refresh token');
    const res = await request.post(`${API}/auth/refresh`, {
      data: { refresh_token: clientRefreshToken },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('access_token');
    expect(data).toHaveProperty('refresh_token');
  });
});

// ============================================
// Flow 4: Admin auth + protected routes
// ============================================
test.describe('Admin Auth Flow', () => {
  let adminToken;

  test('POST /api/auth/login with barber credentials', async ({ request }) => {
    const res = await request.post(`${API}/auth/login`, {
      data: { email: 'admin@admin.com', password: 'admin', type: 'barber' },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('access_token');
    adminToken = data.access_token;
  });

  test('GET /api/admin/services with auth returns services', async ({ request }) => {
    test.skip(!adminToken, 'No admin token');
    const res = await request.get(`${API}/admin/services`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/admin/services without auth returns 401', async ({ request }) => {
    const res = await request.get(`${API}/admin/services`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/admin/system/health returns system status', async ({ request }) => {
    test.skip(!adminToken, 'No admin token');
    const res = await request.get(`${API}/admin/system/health`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('database');
    expect(data).toHaveProperty('crons');
  });
});

// ============================================
// Flow 5: Validation & Security
// ============================================
test.describe('Security', () => {
  test('SQL injection in query params returns 400', async ({ request }) => {
    const res = await request.get(`${API}/availability?barber_id=%27%3B+DROP+TABLE+bookings%3B+--&service_id=${COUPE_HOMME_ID}&date=2026-06-15`);
    expect(res.status()).toBe(400);
  });

  test('Invalid UUID returns 400', async ({ request }) => {
    const res = await request.get(`${API}/bookings/not-a-uuid?token=also-not-a-uuid`);
    expect(res.status()).toBe(400);
  });

  test('404 for unknown route', async ({ request }) => {
    const res = await request.get(`${API}/nonexistent-route`);
    expect(res.status()).toBe(404);
  });

  test('Booking with missing fields returns 400', async ({ request }) => {
    const res = await request.post(`${API}/bookings`, {
      data: { barber_id: LUCAS_ID },
    });
    expect(res.status()).toBe(400);
  });

  test('Login with wrong password returns 401', async ({ request }) => {
    const res = await request.post(`${API}/auth/login`, {
      data: { email: 'admin@admin.com', password: 'wrongpassword', type: 'barber' },
    });
    expect(res.status()).toBe(401);
  });
});

// ============================================
// Flow 6: RGPD endpoints
// ============================================
test.describe('RGPD', () => {
  let rgpdToken;
  let rgpdRefreshToken;
  const rgpdEmail = `e2e-rgpd-${Date.now()}@test.barberclub.fr`;
  const rgpdPassword = 'RgpdTest123!';

  test('Register → Export → Delete account', async ({ request }) => {
    // Register
    const regRes = await request.post(`${API}/auth/register`, {
      data: {
        first_name: 'RGPD',
        last_name: 'Test',
        phone: `06${Date.now().toString().slice(-8)}`,
        email: rgpdEmail,
        password: rgpdPassword,
      },
    });
    expect(regRes.status()).toBe(201);
    const regData = await regRes.json();
    rgpdToken = regData.access_token;

    // Export data
    const exportRes = await request.get(`${API}/client/export-data`, {
      headers: { Authorization: `Bearer ${rgpdToken}` },
    });
    expect(exportRes.status()).toBe(200);
    const exportData = await exportRes.json();
    expect(exportData).toHaveProperty('profile');
    expect(exportData).toHaveProperty('bookings');
    expect(exportData).toHaveProperty('exported_at');
    expect(exportData.profile.first_name).toBe('RGPD');

    // Delete account
    const deleteRes = await request.delete(`${API}/client/delete-account`, {
      headers: { Authorization: `Bearer ${rgpdToken}` },
      data: { password: rgpdPassword },
    });
    expect(deleteRes.status()).toBe(200);
    const deleteData = await deleteRes.json();
    expect(deleteData.message).toContain('supprimé');

    // Verify profile is gone
    const profileRes = await request.get(`${API}/client/profile`, {
      headers: { Authorization: `Bearer ${rgpdToken}` },
    });
    expect(profileRes.status()).toBe(404);
  });
});
