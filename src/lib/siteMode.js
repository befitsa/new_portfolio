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

  // The shared local Vite server can host both the public portfolio and the
  // CMS. Keep this route development-only; production admin routing continues
  // to use the configured admin subdomain.
  if (import.meta.env.DEV && /^\/admin(?:\/|$)/.test(pathname)) {
    return 'admin'
  }

  return 'public'
}
