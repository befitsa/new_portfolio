/**
 * Access-protected same-origin relay to the Firebase HTTPS function.
 * Cloudflare Access must protect the admin hostname and its /api/* path.
 * The Firebase function independently verifies both the signed Access JWT
 * and the Firebase administrator ID token.
 */
export default {
  async fetch(request, env) {
    const assertion = request.headers.get('Cf-Access-Jwt-Assertion')
    if (!assertion) return new Response('Cloudflare Access assertion missing.', { status: 401 })
    if (!env.CMS_BACKEND_URL) return new Response('CMS backend is not configured.', { status: 503 })
    const incoming = new URL(request.url)
    const backend = new URL(env.CMS_BACKEND_URL)
    const prefix = incoming.pathname.replace(/^\/api(?=\/|$)/, '')
    backend.pathname = `${backend.pathname.replace(/\/$/, '')}/api${prefix || '/'}`
    backend.search = incoming.search
    const headers = new Headers()
    for (const name of ['accept', 'content-type', 'origin', 'access-control-request-method', 'access-control-request-headers', 'x-firebase-id-token']) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    headers.set('Cf-Access-Jwt-Assertion', assertion)
    const upstream = new Request(backend, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    })
    return fetch(upstream)
  },
}
