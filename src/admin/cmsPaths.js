export function isPathBasedAdmin() {
  return /^\/admin(?:\/|$)/.test(window.location.pathname)
}

export function cmsHref(path) {
  if (!isPathBasedAdmin() || /^(?:[a-z]+:|#)/i.test(path)) return path
  const pathname = path.startsWith('/') ? path : `/${path}`
  return pathname === '/' ? '/admin' : `/admin${pathname}`
}

export function cmsRoutePath(pathname = window.location.pathname) {
  if (pathname === '/admin') return '/'
  if (pathname.startsWith('/admin/')) return pathname.slice('/admin'.length) || '/'
  return pathname.replace(/\/+$/, '') || '/'
}
