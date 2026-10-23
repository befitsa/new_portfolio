const configuredAdminSubdomain = (
  import.meta.env.VITE_ADMIN_SUBDOMAIN || 'dev'
).trim().toLowerCase()

export function getSiteMode(hostname = window.location.hostname, pathname = window.location.pathname) {
  const normalizedHostname = hostname.trim().toLowerCase()

  if (
    configuredAdminSubdomain &&
    normalizedHostname.startsWith(`${configuredAdminSubdomain}.`)
  ) {
    return 'admin'
  }

  if (/^\/admin(?:\/|$)/.test(pathname)) {
    return 'admin'
  }

  return 'public'
}
