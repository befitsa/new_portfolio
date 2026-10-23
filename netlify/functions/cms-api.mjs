const FUNCTION_PREFIX = '/.netlify/functions/cms-api'
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const MAX_BODY_BYTES = 2 * 1024 * 1024

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
    body: JSON.stringify(payload),
  }
}

function requestUrl(event) {
  const source = event.rawUrl || event.path || '/api'
  const url = new URL(source, 'https://netlify.invalid')
  if (!url.search && event.queryStringParameters) {
    url.search = new URLSearchParams(event.queryStringParameters).toString()
  }
  if (url.pathname.startsWith(FUNCTION_PREFIX)) {
    url.pathname = url.pathname.slice(FUNCTION_PREFIX.length) || '/api'
  }
  return url
}

function header(headers = {}, name) {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
  return key ? headers[key] : undefined
}

function bodyFor(event) {
  if (event.body == null || event.body === '') return undefined
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body, 'utf8')
}

function configuredWorkerUrl(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url
  } catch {
    return null
  }
}

function validApiPayload(payload) {
  return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload)
    && (Object.hasOwn(payload, 'data') || typeof payload.error === 'string'))
}

export function createHandler({ env = process.env, fetchImpl = fetch } = {}) {
  return async function cmsApiHandler(event = {}) {
    let incoming
    try {
      incoming = requestUrl(event)
    } catch {
      return jsonResponse(400, { error: 'Invalid CMS API request URL.' })
    }

    if (incoming.pathname !== '/api' && !incoming.pathname.startsWith('/api/')) {
      return jsonResponse(404, { error: 'CMS API route not found.' })
    }

    const method = String(event.httpMethod || event.requestContext?.http?.method || 'GET').toUpperCase()
    if (!ALLOWED_METHODS.has(method)) return jsonResponse(405, { error: 'Method not allowed.' })

    const idToken = header(event.headers, 'x-firebase-id-token')
    if (!idToken) return jsonResponse(401, { error: 'Firebase administrator sign-in required.' })

    const workerBase = configuredWorkerUrl(env.CMS_WORKER_URL)
    const accessClientId = env.CF_ACCESS_CLIENT_ID
    const accessClientSecret = env.CF_ACCESS_CLIENT_SECRET
    if (!workerBase || !accessClientId || !accessClientSecret) {
      return jsonResponse(503, { error: 'CMS API proxy is not configured. Contact the site administrator.' })
    }

    let body
    try {
      body = bodyFor(event)
    } catch {
      return jsonResponse(400, { error: 'CMS request body could not be decoded.' })
    }
    if (body && body.byteLength > MAX_BODY_BYTES) {
      return jsonResponse(413, { error: 'CMS request body exceeds the 2 MB limit.' })
    }

    const target = new URL(`${incoming.pathname}${incoming.search}`, workerBase)
    const headers = new Headers({
      Accept: header(event.headers, 'accept') || 'application/json',
      'CF-Access-Client-Id': accessClientId,
      'CF-Access-Client-Secret': accessClientSecret,
    })
    for (const name of ['content-type', 'origin']) {
      const value = header(event.headers, name)
      if (typeof value === 'string' && value) headers.set(name, value)
    }
    headers.set('x-firebase-id-token', idToken)

    let upstream
    try {
      upstream = await fetchImpl(target, {
        method,
        headers,
        body: ['GET', 'HEAD'].includes(method) ? undefined : body,
        redirect: 'manual',
      })
    } catch {
      return jsonResponse(502, { error: 'The CMS API worker could not be reached.' })
    }

    const contentType = upstream.headers.get('content-type') || ''
    let payload
    try {
      if (!contentType.toLowerCase().includes('application/json')) throw new Error('Not JSON')
      payload = JSON.parse(await upstream.text())
      if (!validApiPayload(payload)) throw new Error('Invalid API envelope')
    } catch {
      return jsonResponse(502, { error: 'The CMS worker returned an invalid response. Check its Cloudflare Access and backend configuration.' })
    }
    return jsonResponse(upstream.status, payload)
  }
}

export const handler = createHandler()
