export const ADMIN_SECTIONS = Object.freeze([
  Object.freeze({ label: 'Dashboard', path: '/' }),
  Object.freeze({ label: 'Projects Management', path: '/projects' }),
  Object.freeze({ label: 'Background Management', path: '/background' }),
  Object.freeze({ label: 'Resume Management', path: '/resume' }),
  Object.freeze({ label: 'Media Library', path: '/media' }),
  Object.freeze({ label: 'Portfolio Settings', path: '/settings' }),
])

export function adminPathForSection(label) {
  return ADMIN_SECTIONS.find((section) => section.label === label)?.path || '/'
}

export function adminSectionForPath(pathname) {
  const path = pathname.replace(/^\/admin/, '').replace(/\/+$/, '') || '/'
  if (path === '/') return 'Dashboard'
  if (path.startsWith('/projects/')) return 'Projects Management'
  return ADMIN_SECTIONS.find((section) => section.path !== '/' && section.path === path)?.label || 'Dashboard'
}
