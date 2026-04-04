/**
 * Timezone-safe date helpers (Europe/Paris)
 *
 * Avoid `new Date().toISOString().split('T')[0]` which returns UTC date.
 * At 23:30 Paris time, UTC is already the next day.
 */

function getParisNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
}

function getParisTodayISO() {
  const now = getParisNow();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = { getParisNow, getParisTodayISO };
