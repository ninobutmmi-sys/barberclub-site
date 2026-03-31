const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, 'email-templates');

// In-memory cache: template name -> raw HTML string
const cache = {};

/**
 * Load an HTML email template and replace all {{key}} placeholders with values.
 * Templates are read from disk once and cached in memory for performance.
 *
 * @param {string} name - Template name without extension (e.g. 'confirmation')
 * @param {Object} vars - Key-value pairs for placeholder replacement
 * @returns {string} HTML string with all placeholders replaced
 */
function loadTemplate(name, vars = {}) {
  if (!cache[name]) {
    const filePath = path.join(TEMPLATES_DIR, `${name}.html`);
    cache[name] = fs.readFileSync(filePath, 'utf-8');
  }

  let html = cache[name];

  // Replace all {{key}} with corresponding value from vars
  // Use a global regex to catch every occurrence
  html = html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in vars ? vars[key] : match;
  });

  return html;
}

module.exports = { loadTemplate };
