import assert from 'node:assert/strict'
import test from 'node:test'
import { createHandler } from '../netlify/functions/cms-api.mjs'
import cloudflareWorker from '../cloudflare/worker.js'

const env = {
  CMS_WORKER_URL: 'https://cms.example.test',
  CF_ACCESS_CLIENT_ID: 'test-access-client-id',
  CF_ACCESS_CLIENT_SECRET: 'test-access-client-secret',
}

function event({ path = '/api/health', method = 'GET', body, headers = {}, rawUrl } = {}) {
  return {
    httpMethod: method,
    path,
    rawUrl,
    headers,
    body,
  }
}

test('Netlify proxy returns JSON when server-side Access configuration is missing', async () => {
  const handler = createHandler({ env: {}, fetchImpl: async () => { throw new Error('must not fetch') } })
  const response = await handler(event({ headers: { 'x-firebase-id-token': 'valid-shaped-token' } }))
  assert.equal(response.statusCode, 503)
  assert.match(response.headers['Content-Type'], /application\/json/)
  assert.equal(JSON.parse(response.body).error, 'CMS API proxy is not configured. Contact the site administrator.')
})

test('Netlify proxy requires the Firebase identity header and handles rewritten function paths', async () => {
  let forwardedUrl
  const handler = createHandler({
    env,
    fetchImpl: async (url) => {
      forwardedUrl = String(url)
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const unauthorized = await handler(event({ path: '/.netlify/functions/cms-api/api/health' }))
  assert.equal(unauthorized.statusCode, 401)
  assert.match(unauthorized.headers['Content-Type'], /application\/json/)

  const response = await handler(event({
    path: '/.netlify/functions/cms-api/api/health',
    headers: { 'x-firebase-id-token': 'firebase-id-token' },
  }))
  assert.equal(response.statusCode, 200)
  assert.equal(forwardedUrl, 'https://cms.example.test/api/health')
})

test('Netlify proxy forwards the API path, query, Firebase token, and server-side Access credentials', async () => {
  let call
  const handler = createHandler({
    env,
    fetchImpl: async (url, options) => {
      call = { url: String(url), options }
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const response = await handler(event({
    rawUrl: 'https://site.example.test/api/projects?view=drafts',
    headers: { 'x-firebase-id-token': 'firebase-id-token', origin: 'https://site.example.test' },
  }))
  assert.equal(response.statusCode, 200)
  assert.equal(call.url, 'https://cms.example.test/api/projects?view=drafts')
  assert.equal(call.options.headers.get('x-firebase-id-token'), 'firebase-id-token')
  assert.equal(call.options.headers.get('cf-access-client-id'), env.CF_ACCESS_CLIENT_ID)
  assert.equal(call.options.headers.get('cf-access-client-secret'), env.CF_ACCESS_CLIENT_SECRET)
  assert.deepEqual(JSON.parse(response.body), { data: { ok: true } })
})

test('Netlify proxy forwards valid API errors and normalizes HTML login responses to JSON', async () => {
  const notFoundHandler = createHandler({
    env,
    fetchImpl: async () => new Response(JSON.stringify({ error: 'Not found.' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }),
  })
  const notFound = await notFoundHandler(event({
    rawUrl: 'https://site.example.test/api/not-a-route',
    headers: { 'x-firebase-id-token': 'firebase-id-token' },
  }))
  assert.equal(notFound.statusCode, 404)
  assert.deepEqual(JSON.parse(notFound.body), { error: 'Not found.' })

  const htmlHandler = createHandler({
    env,
    fetchImpl: async () => new Response('<html>Access login</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  })
  const invalid = await htmlHandler(event({ headers: { 'x-firebase-id-token': 'firebase-id-token' } }))
  assert.equal(invalid.statusCode, 502)
  assert.match(invalid.headers['Content-Type'], /application\/json/)
  assert.match(JSON.parse(invalid.body).error, /invalid response/i)
})

test('Cloudflare worker returns JSON errors and preserves backend API paths', async () => {
  const missingAssertion = await cloudflareWorker.fetch(new Request('https://cms.example.test/api/health'), {})
  assert.equal(missingAssertion.status, 401)
  assert.match(missingAssertion.headers.get('content-type'), /application\/json/)

  let forwardedUrl
  const worker = (await import('../cloudflare/worker.js')).createWorker(async (request) => {
    forwardedUrl = request.url
    return new Response(JSON.stringify({ data: { ok: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  const response = await worker.fetch(new Request('https://cms.example.test/api/health?q=1', {
    headers: { 'Cf-Access-Jwt-Assertion': 'access-jwt' },
  }), { CMS_BACKEND_URL: 'https://functions.example.test/cmsApi' })
  assert.equal(response.status, 200)
  assert.equal(forwardedUrl, 'https://functions.example.test/cmsApi/api/health?q=1')
  assert.deepEqual(await response.json(), { data: { ok: true } })
})
