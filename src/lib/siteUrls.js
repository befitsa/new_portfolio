const DEVELOPMENT_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function getPublicSiteUrl(location = window.location) {
  const hostname = location.hostname.toLowerCase()
  const isLocalDevelopment =
    DEVELOPMENT_HOSTS.has(hostname) || hostname.endsWith('.localhost')

  if (import.meta.env.DEV) {
    return new URL('/', location.href).toString()
  }

  if (isLocalDevelopment) {
    return 'http://localhost:5173/'
  }

  const configuredUrl = import.meta.env.VITE_PUBLIC_PORTFOLIO_URL?.trim()

  if (!configuredUrl) {
    throw new Error('Set VITE_PUBLIC_PORTFOLIO_URL to open the public portfolio.')
  }

  const publicUrl = new URL(configuredUrl)
  if (publicUrl.protocol !== 'https:' && publicUrl.protocol !== 'http:') {
    throw new Error('VITE_PUBLIC_PORTFOLIO_URL must use HTTP or HTTPS.')
  }

  return publicUrl.toString()
}
