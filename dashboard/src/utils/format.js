export function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' \u20ac';
}

export function formatDateFR(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
