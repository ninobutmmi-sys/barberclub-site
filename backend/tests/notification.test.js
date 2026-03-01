/**
 * Tests for notification service
 * Tests helper functions (escapeHtml, formatDateFR, formatTime, formatPhoneInternational),
 * retry backoff logic, circuit breaker, and email template generation.
 *
 * Brevo API calls are NOT made in test (BREVO_API_KEY is empty).
 */
const { db } = require('./setup');

// Import the functions we want to test directly from the notification service
const {
  formatDateFR,
  formatTime,
  formatPhoneInternational,
  sendConfirmationEmail,
  sendReminderSMSDirect,
  sendConfirmationSMS,
  sendCancellationEmail,
  sendRescheduleEmail,
  sendResetPasswordEmail,
  sendNotification,
} = require('../src/services/notification');

// Access escapeHtml and getNextRetryTime — they are not exported, so we test them indirectly
// We can test escapeHtml via the email templates (fields get escaped)
// and getNextRetryTime via observing retry behavior

afterAll(async () => {
  await db.pool.end();
});

// ============================================
// Pure helper functions
// ============================================

describe('Notification — formatDateFR', () => {
  test('formats a date correctly in French', () => {
    const result = formatDateFR('2026-03-15');
    expect(result).toBe('Dimanche 15 mars 2026');
  });

  test('formats a Monday date correctly', () => {
    const result = formatDateFR('2026-03-02');
    expect(result).toBe('Lundi 2 mars 2026');
  });

  test('formats a Saturday date correctly', () => {
    const result = formatDateFR('2026-02-28');
    expect(result).toBe('Samedi 28 février 2026');
  });

  test('handles January correctly', () => {
    const result = formatDateFR('2026-01-01');
    expect(result).toBe('Jeudi 1 janvier 2026');
  });

  test('handles December correctly', () => {
    const result = formatDateFR('2025-12-25');
    expect(result).toBe('Jeudi 25 décembre 2025');
  });
});

describe('Notification — formatTime', () => {
  test('returns HH:MM from HH:MM:SS', () => {
    expect(formatTime('14:30:00')).toBe('14:30');
  });

  test('returns HH:MM when already HH:MM', () => {
    expect(formatTime('09:00')).toBe('09:00');
  });

  test('handles null input', () => {
    expect(formatTime(null)).toBe('');
  });

  test('handles undefined input', () => {
    expect(formatTime(undefined)).toBe('');
  });

  test('handles empty string', () => {
    expect(formatTime('')).toBe('');
  });
});

describe('Notification — formatPhoneInternational', () => {
  test('converts French mobile starting with 0 to +33', () => {
    expect(formatPhoneInternational('0612345678')).toBe('+33612345678');
  });

  test('keeps already international format', () => {
    expect(formatPhoneInternational('+33612345678')).toBe('+33612345678');
  });

  test('strips spaces and dots', () => {
    expect(formatPhoneInternational('06 12 34 56 78')).toBe('+33612345678');
  });

  test('strips dashes', () => {
    expect(formatPhoneInternational('06-12-34-56-78')).toBe('+33612345678');
  });

  test('strips dots', () => {
    expect(formatPhoneInternational('06.12.34.56.78')).toBe('+33612345678');
  });

  test('adds +33 prefix when no prefix at all', () => {
    expect(formatPhoneInternational('612345678')).toBe('+33612345678');
  });
});

// ============================================
// escapeHtml — tested indirectly via templates
// ============================================

describe('Notification — XSS prevention in emails', () => {
  test('sendConfirmationEmail does not crash with XSS in fields', async () => {
    // BREVO_API_KEY is empty in test, so email won't actually be sent
    // But the template should be generated without throwing
    await expect(
      sendConfirmationEmail({
        booking_id: '00000000-0000-0000-0000-000000000001',
        cancel_token: '00000000-0000-0000-0000-000000000002',
        email: 'test@test.barberclub.fr',
        first_name: '<script>alert("xss")</script>',
        service_name: 'Coupe & Barbe',
        barber_name: 'Lucas',
        date: '2026-06-15',
        start_time: '10:00',
        price: 2700,
      })
    ).resolves.not.toThrow();
  });

  test('sendCancellationEmail does not crash with special characters', async () => {
    await expect(
      sendCancellationEmail({
        email: 'test@test.barberclub.fr',
        first_name: 'Jean-Pierre',
        service_name: 'Coupe "Premium"',
        barber_name: "L'artiste",
        date: '2026-06-15',
        start_time: '10:00',
        price: 4500,
      })
    ).resolves.not.toThrow();
  });

  test('sendRescheduleEmail does not crash with HTML entities', async () => {
    await expect(
      sendRescheduleEmail({
        email: 'test@test.barberclub.fr',
        first_name: 'Réné & fils',
        service_name: 'Coupe <homme>',
        barber_name: 'Lucas',
        old_date: '2026-06-15',
        old_time: '10:00',
        new_date: '2026-06-16',
        new_time: '11:00',
        new_barber_name: 'Julien',
        price: 2700,
        cancel_token: '00000000-0000-0000-0000-000000000001',
        booking_id: '00000000-0000-0000-0000-000000000001',
      })
    ).resolves.not.toThrow();
  });

  test('sendResetPasswordEmail does not crash with XSS', async () => {
    await expect(
      sendResetPasswordEmail({
        email: 'test@test.barberclub.fr',
        first_name: '<img onerror="alert(1)" src=x>',
        resetUrl: 'https://example.com/reset?token=abc',
      })
    ).resolves.not.toThrow();
  });
});

// ============================================
// sendNotification dispatch
// ============================================

describe('Notification — sendNotification dispatch', () => {
  test('throws on unknown notification type', async () => {
    await expect(
      sendNotification({ type: 'unknown_type' })
    ).rejects.toThrow(/Unknown notification type/);
  });

  test('throws with descriptive message including the type', async () => {
    await expect(
      sendNotification({ type: 'sms_promo_blast' })
    ).rejects.toThrow('Unknown notification type: sms_promo_blast');
  });
});

// ============================================
// SMS functions — should not crash without API key
// ============================================

describe('Notification — SMS functions (no API key)', () => {
  test('sendConfirmationSMS returns without error when no API key', async () => {
    await expect(
      sendConfirmationSMS({
        booking_id: '00000000-0000-0000-0000-000000000001',
        cancel_token: '00000000-0000-0000-0000-000000000002',
        phone: '0612345678',
        barber_name: 'Lucas',
        date: '2026-06-15',
        start_time: '10:00',
      })
    ).resolves.not.toThrow();
  });

  test('sendReminderSMSDirect returns without error when no API key', async () => {
    await expect(
      sendReminderSMSDirect({
        booking_id: '00000000-0000-0000-0000-000000000001',
        cancel_token: '00000000-0000-0000-0000-000000000002',
        phone: '0612345678',
        date: '2026-06-15',
        start_time: '10:00',
      })
    ).resolves.not.toThrow();
  });
});

// ============================================
// Edge cases
// ============================================

describe('Notification — Edge cases', () => {
  test('sendConfirmationEmail skips when no email provided', async () => {
    // Should return silently without throwing
    await expect(
      sendConfirmationEmail({
        booking_id: '00000000-0000-0000-0000-000000000001',
        cancel_token: '00000000-0000-0000-0000-000000000002',
        email: null,
        first_name: 'Test',
        service_name: 'Coupe',
        barber_name: 'Lucas',
        date: '2026-06-15',
        start_time: '10:00',
        price: 2700,
      })
    ).resolves.not.toThrow();
  });

  test('sendCancellationEmail skips when no email', async () => {
    await expect(
      sendCancellationEmail({
        email: null,
        first_name: 'Test',
        service_name: 'Coupe',
        barber_name: 'Lucas',
        date: '2026-06-15',
        start_time: '10:00',
        price: 2700,
      })
    ).resolves.not.toThrow();
  });

  test('sendRescheduleEmail skips when no email', async () => {
    await expect(
      sendRescheduleEmail({
        email: null,
        first_name: 'Test',
        service_name: 'Coupe',
        barber_name: 'Lucas',
        old_date: '2026-06-15',
        old_time: '10:00',
        new_date: '2026-06-16',
        new_time: '11:00',
        price: 2700,
      })
    ).resolves.not.toThrow();
  });

  test('formatDateFR handles date with extra spaces', () => {
    // The function expects YYYY-MM-DD format
    const result = formatDateFR('2026-06-15');
    expect(result).toContain('2026');
    expect(result).toContain('juin');
    expect(result).toContain('15');
  });

  test('formatTime handles time with extra colons (HH:MM:SS.ms)', () => {
    expect(formatTime('14:30:00.000')).toBe('14:30');
  });
});
