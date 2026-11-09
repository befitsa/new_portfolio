const DEVELOPMENT_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function isLocalHost(hostname) {
  return DEVELOPMENT_HOSTS.has(hostname) || hostname.endsWith('.localhost')
}

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
  isProduction = false,
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
    if (isProduction && isLocalHost(redirectUrl.hostname)) {
      throw new Error('Production password recovery cannot redirect to localhost.')
    }
    if (redirectUrl.pathname !== '/admin/reset-password') {
      throw new Error('VITE_ADMIN_RECOVERY_REDIRECT_URL must end in /admin/reset-password.')
    }
    return redirectUrl.toString()
  }

  if (isProduction) {
    throw new Error('VITE_ADMIN_RECOVERY_REDIRECT_URL must be configured for production password recovery.')
  }

  const configuredPublicSiteUrl = publicSiteUrl?.trim()
  let baseUrl
  try {
    baseUrl = new URL(configuredPublicSiteUrl || origin)
  } catch {
    throw new Error('VITE_PUBLIC_PORTFOLIO_URL must be a valid HTTP or HTTPS URL.')
  }
  validateRecoveryUrl(baseUrl, 'VITE_PUBLIC_PORTFOLIO_URL')
  if (isLocalHost(baseUrl.hostname) && !configuredPublicSiteUrl) {
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
