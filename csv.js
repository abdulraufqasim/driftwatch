(function exposeCsv(root) {
  function escapeCsvValue(value) {
    const text = value === null || value === undefined ? '' : String(value);
    const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  }

  function rowsToCsv(rows) {
    return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n');
  }

  const csv = { escapeCsvValue, rowsToCsv };
  root.DriftwatchCsv = csv;
  if (typeof module !== 'undefined' && module.exports) module.exports = csv;
}(typeof window === 'undefined' ? globalThis : window));
