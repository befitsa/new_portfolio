const DEVELOPMENT_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function validateRecoveryUrl(url, variableName) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${variableName} must use HTTP or HTTPS.`)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${variableName} must not contain credentials, query parameters, or a fragment.`)
  }
  return url
}

export function getAdminRecoveryRedirectUrl({
  configuredRedirectUrl,
  publicSiteUrl,
  origin,
}) {
  if (!origin) throw new Error('The current application origin is unavailable.')

  const configured = configuredRedirectUrl?.trim()
  if (configured) {
    let redirectUrl
    try {
      redirectUrl = new URL(configured)
    } catch {
      throw new Error('VITE_ADMIN_RECOVERY_REDIRECT_URL must be a valid HTTP or HTTPS URL.')
    }

    validateRecoveryUrl(redirectUrl, 'VITE_ADMIN_RECOVERY_REDIRECT_URL')
    if (redirectUrl.pathname !== '/admin/reset-password') {
      throw new Error('VITE_ADMIN_RECOVERY_REDIRECT_URL must end in /admin/reset-password.')
    }
    return redirectUrl.toString()
  }

  const configuredPublicSiteUrl = publicSiteUrl?.trim()
  let baseUrl
  try {
    baseUrl = new URL(configuredPublicSiteUrl || origin)
  } catch {
    throw new Error('VITE_PUBLIC_PORTFOLIO_URL must be a valid HTTP or HTTPS URL.')
  }
  validateRecoveryUrl(baseUrl, 'VITE_PUBLIC_PORTFOLIO_URL')
  const isLocalHost = baseUrl.hostname === 'localhost'
    || baseUrl.hostname === '127.0.0.1'
    || baseUrl.hostname === '[::1]'
    || baseUrl.hostname.endsWith('.localhost')
  if (isLocalHost && !configuredPublicSiteUrl) {
    throw new Error('Set VITE_ADMIN_RECOVERY_REDIRECT_URL or VITE_PUBLIC_PORTFOLIO_URL before requesting recovery from localhost.')
  }
  return new URL('/admin/reset-password', baseUrl).toString()
}

export function getPublicSiteUrl(location = window.location) {
  const hostname = location.hostname.toLowerCase()
  const isLocalDevelopment =
    DEVELOPMENT_HOSTS.has(hostname) || hostname.endsWith('.localhost')

  if (import.meta.env.DEV) {
    return new URL('/', location.href).toString()
  }

  if (isLocalDevelopment) {
    return 'http://localhost:3000/'
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
