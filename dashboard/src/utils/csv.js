/**
 * Export an array of objects as a CSV file and trigger a browser download.
 *
 * @param {Object[]} data - Array of row objects to export
 * @param {string} filename - Name for the downloaded file (e.g. "clients.csv")
 * @param {{ key: string, label: string }[]} columns - Column definitions controlling
 *   which fields are exported and their header labels
 */
export function exportToCSV(data, filename, columns) {
  if (!data || data.length === 0) return;

  const separator = ';';

  // Build header row from column labels
  const header = columns.map((col) => escapeCSV(col.label)).join(separator);

  // Build data rows
  const rows = data.map((row) =>
    columns
      .map((col) => {
        const value = row[col.key];
        return escapeCSV(value != null ? String(value) : '');
      })
      .join(separator)
  );

  // Combine with BOM for Excel UTF-8 compatibility
  const bom = '\uFEFF';
  const csvContent = bom + [header, ...rows].join('\r\n');

  // Create and trigger download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Escape a value for CSV: wrap in quotes if it contains separator, quotes, or newlines.
 * @param {string} value
 * @returns {string}
 */
function escapeCSV(value) {
  if (value.includes(';') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
