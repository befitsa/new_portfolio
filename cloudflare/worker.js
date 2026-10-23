/**
 * Access-protected same-origin relay to the Firebase HTTPS function.
 * Cloudflare Access must protect the admin hostname and its /api/* path.
 * The Firebase function independently verifies both the signed Access JWT
 * and the Firebase administrator ID token.
 */
export default {
  ...createWorker(),
}

function jsonResponse(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function validApiPayload(payload) {
  return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload)
    && (Object.hasOwn(payload, 'data') || typeof payload.error === 'string'))
}

export function createWorker(fetchImpl = fetch) {
  return {
    async fetch(request, env = {}) {
      const incoming = new URL(request.url)
      if (incoming.pathname !== '/api' && !incoming.pathname.startsWith('/api/')) {
        return jsonResponse(404, 'CMS API route not found.')
      }
      const assertion = request.headers.get('Cf-Access-Jwt-Assertion')
      if (!assertion) return jsonResponse(401, 'Cloudflare Access assertion missing.')
      if (!env.CMS_BACKEND_URL) return jsonResponse(503, 'CMS backend is not configured.')

      let backend
      try {
        backend = new URL(env.CMS_BACKEND_URL)
        if (backend.protocol !== 'https:' || backend.username || backend.password) throw new Error('Invalid backend URL')
      } catch {
        return jsonResponse(503, 'CMS backend is not configured.')
      }

      const prefix = incoming.pathname.replace(/^\/api(?=\/|$)/, '')
      backend.pathname = `${backend.pathname.replace(/\/$/, '')}/api${prefix || '/'}`
      backend.search = incoming.search
      const headers = new Headers()
      for (const name of ['accept', 'content-type', 'origin', 'access-control-request-method', 'access-control-request-headers', 'x-firebase-id-token']) {
        const value = request.headers.get(name)
        if (value) headers.set(name, value)
      }
      headers.set('Cf-Access-Jwt-Assertion', assertion)
      const upstreamRequest = new Request(backend, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? undefined : request.body,
        redirect: 'manual',
      })

      let upstream
      try {
        upstream = await fetchImpl(upstreamRequest)
      } catch {
        return jsonResponse(502, 'CMS backend could not be reached.')
      }
      try {
        if (!upstream.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new Error('Not JSON')
        const body = await upstream.text()
        if (!validApiPayload(JSON.parse(body))) throw new Error('Invalid API envelope')
        return new Response(body, {
          status: upstream.status,
          headers: {
            'Cache-Control': 'private, no-store',
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      } catch {
        return jsonResponse(502, 'CMS backend returned an invalid API response.')
      }
    },
  }
}
