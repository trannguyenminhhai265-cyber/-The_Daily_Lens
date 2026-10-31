// Role-Based Access Control definitions.
// Every role maps to a default set of permissions; a Super Admin can grant extra
// permissions to individual users (stored on User.permissions).

const PERMISSIONS = {
  USERS_MANAGE: 'users:manage',
  LOGS_VIEW: 'logs:view',
  SETTINGS_MANAGE: 'settings:manage',
  CONTENT_MANAGE: 'content:manage',
  CONTENT_PUBLISH: 'content:publish',
  TAXONOMY_MANAGE: 'taxonomy:manage',
  COMMENTS_MODERATE: 'comments:moderate',
  REPORTS_HANDLE: 'reports:handle',
  SEO_MANAGE: 'seo:manage',
  ANALYTICS_VIEW: 'analytics:view',
};

const PERMISSION_LABELS = {
  'users:manage': 'Manage user accounts, roles & permissions',
  'logs:view': 'View system logs',
  'settings:manage': 'Configure global settings',
  'content:manage': 'Create, edit and delete articles',
  'content:publish': 'Publish / unpublish articles',
  'taxonomy:manage': 'Manage categories and tags',
  'comments:moderate': 'Moderate user comments',
  'reports:handle': 'Handle flags / reports',
  'seo:manage': 'Edit SEO metadata',
  'analytics:view': 'View analytics dashboards',
};

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  CONTENT_MANAGER: 'content_manager',
  MODERATOR: 'moderator',
  SEO_SPECIALIST: 'seo_specialist',
  USER: 'user',
};

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  content_manager: 'Content Manager',
  moderator: 'Moderator',
  seo_specialist: 'Data & SEO Specialist',
  user: 'Reader',
};

const P = PERMISSIONS;
const ROLE_PERMISSIONS = {
  super_admin: Object.values(PERMISSIONS),
  content_manager: [P.CONTENT_MANAGE, P.CONTENT_PUBLISH, P.TAXONOMY_MANAGE],
  moderator: [P.COMMENTS_MODERATE, P.REPORTS_HANDLE],
  seo_specialist: [P.SEO_MANAGE, P.ANALYTICS_VIEW],
  user: [],
};

function permissionsFor(user) {
  if (!user) return new Set();
  return new Set([...(ROLE_PERMISSIONS[user.role] || []), ...(user.permissions || [])]);
}

module.exports = {
  PERMISSIONS,
  PERMISSION_LABELS,
  ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  permissionsFor,
};
