export function formatDate(value, opts = { year: 'numeric', month: 'short', day: 'numeric' }) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-GB', opts);
}

export function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export function timeAgo(value) {
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (diff < 60) return 'just now';
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [name, secs] of units) {
    const n = Math.floor(diff / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

export function compact(n) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  content_manager: 'Content Manager',
  moderator: 'Moderator',
  seo_specialist: 'Data & SEO Specialist',
  user: 'Reader',
};

export const STAFF_PERMISSIONS = [
  'users:manage',
  'logs:view',
  'settings:manage',
  'content:manage',
  'content:publish',
  'taxonomy:manage',
  'comments:moderate',
  'reports:handle',
  'seo:manage',
  'analytics:view',
];

export function setPageMeta(title, description) {
  document.title = title;
  if (description !== undefined) {
    let tag = document.querySelector('meta[name="description"]');
    if (!tag) {
      tag = document.createElement('meta');
      tag.name = 'description';
      document.head.appendChild(tag);
    }
    tag.content = description;
  }
}
