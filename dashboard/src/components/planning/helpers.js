// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { COLOR_PALETTE } from '../../utils/constants';

export { COLOR_PALETTE };

export function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' \u20ac';
}

export function timeToMinutes(t) {
  if (!t) return 0;
  const parts = t.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

export const HOUR_START = 8;
export const HOUR_END = 20;
export const TOTAL_MINUTES = (HOUR_END - HOUR_START) * 60;
// Off-hours zones (visible but grayed out — bookings still allowed)
export const OFF_HOURS = [
  { startHour: 8, endHour: 9 },   // Before opening
  { startHour: 19, endHour: 20 },  // After closing
];
export const PX_PER_MIN = 3;
export const GRID_HEIGHT = TOTAL_MINUTES * PX_PER_MIN; // 1800px
export const HOUR_HEIGHT = 60 * PX_PER_MIN; // 180px

export const STATUS_LABELS = {
  confirmed: 'Confirm\u00e9',
  completed: 'Termin\u00e9',
  no_show: 'No-show',
  cancelled: 'Annul\u00e9',
};

// Fallback color palette for bookings without service_color
export const FALLBACK_COLOR = '#22c55e';

// Convert a hex color to block style (opaque bg, solid border) — theme-aware
export function hexToBlockStyle(hex) {
  if (!hex || hex.length !== 7) hex = '#22c55e';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const base = isDark ? [17, 17, 19] : [245, 245, 247];
  const alpha = isDark ? 0.30 : 0.25;
  const br = Math.round(r * alpha + base[0] * (1 - alpha));
  const bg = Math.round(g * alpha + base[1] * (1 - alpha));
  const bb = Math.round(b * alpha + base[2] * (1 - alpha));
  return {
    bg: `rgb(${br},${bg},${bb})`,
    border: hex,
    text: isDark ? '#fff' : '#111',
  };
}

export const STATUS_OVERRIDES = {
  no_show: { bg: 'var(--status-noshow-bg)', border: '#ef4444', text: 'var(--text)' },
  cancelled: { bg: 'var(--status-cancelled-bg)', border: 'var(--status-cancelled-border)', text: 'var(--text-muted)' },
};
