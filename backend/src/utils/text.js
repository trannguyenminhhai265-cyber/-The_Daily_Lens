const sanitizeHtml = require('sanitize-html');

function slugify(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ALLOWED_HTML = {
  allowedTags: [
    'p', 'br', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'ul', 'ol', 'li',
    'a', 'img', 'figure', 'figcaption', 'code', 'pre', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

function sanitizeContent(html) {
  return sanitizeHtml(String(html || ''), ALLOWED_HTML);
}

function htmlToText(html) {
  const withBreaks = String(html || '').replace(/<\/(p|h[1-6]|li|blockquote|figcaption|tr)>/gi, '\n');
  const text = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function readingTime(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/** Returns the distinct lower-case usernames tagged with @username in a text. */
function extractMentions(text) {
  const found = new Set();
  const re = /(^|[^a-z0-9_@])@([a-z0-9_]{3,30})/gi;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) found.add(m[2].toLowerCase());
  return [...found];
}

function countLinks(text) {
  return (String(text || '').match(/https?:\/\/|www\./gi) || []).length;
}

module.exports = { slugify, escapeRegex, sanitizeContent, htmlToText, readingTime, extractMentions, countLinks };
