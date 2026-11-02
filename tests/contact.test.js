import test from 'node:test'
import assert from 'node:assert/strict'
import { consumeRateLimit, createContactHandler } from '../netlify/functions/contact.mjs'

const validMessage = {
  name: '  Amina Example  ',
  email: '  amina@example.com  ',
  subject: '  Website redesign  ',
  message: '  I would like to discuss a new portfolio website.  ',
}

function makeRequest(body, { origin = 'https://portfolio.example', method = 'POST' } = {}) {
  return new Request('https://portfolio.example/api/contact', {
    method,
    headers: {
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  })
}

function setup(overrides = {}) {
  const sent = []
  const logger = { error() {} }
  const handler = createContactHandler({
    env: {
      RESEND_API_KEY: 'test-secret-not-for-client',
      CONTACT_FROM_EMAIL: 'Portfolio <onboarding@resend.dev>',
      ...overrides.env,
    },
    rateLimit: async () => true,
    now: () => new Date('2026-11-02T08:30:00.000Z'),
    logger,
    fetchImpl: async (url, options) => {
      sent.push({ url, options })
      return new Response(JSON.stringify({ id: 'resend-message-id' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
    ...overrides,
  })
  return { handler, sent }
}

test('contact endpoint sends a validated message with recipient, reply-to, subject, and timestamp', async () => {
  const { handler, sent } = setup()
  const response = await handler(makeRequest(validMessage), { ip: '192.0.2.10' })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { accepted: true })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].url, 'https://api.resend.com/emails')
  assert.equal(sent[0].options.headers.Authorization, 'Bearer test-secret-not-for-client')
  const payload = JSON.parse(sent[0].options.body)
  assert.deepEqual(payload.to, ['befitsa123@gmail.com'])
  assert.equal(payload.reply_to, 'amina@example.com')
  assert.equal(payload.subject, 'Portfolio Contact: Website redesign')
  assert.match(payload.text, /Name: Amina Example/)
  assert.match(payload.text, /Email: amina@example\.com/)
  assert.match(payload.text, /Submitted: 2026-11-02T08:30:00\.000Z/)
  assert.match(payload.text, /I would like to discuss a new portfolio website\./)
})

test('contact endpoint rejects missing, invalid, and oversized fields without calling Resend', async () => {
  const { handler, sent } = setup()
  for (const body of [
    {},
    { ...validMessage, email: 'bad email' },
    { ...validMessage, name: 'A\nB' },
    { ...validMessage, subject: 'Hi\r\nBcc: other@example.com' },
    { ...validMessage, message: 'short' },
    { ...validMessage, message: 'x'.repeat(5001) },
  ]) {
    const response = await handler(makeRequest(body), { ip: '192.0.2.11' })
    assert.equal(response.status, 422)
  }
  assert.equal(sent.length, 0)
})

test('provider rejection returns failure and does not claim delivery', async () => {
  const { handler } = setup({
    fetchImpl: async () => new Response('provider unavailable', { status: 503 }),
  })
  const response = await handler(makeRequest(validMessage), { ip: '192.0.2.12' })
  assert.equal(response.status, 502)
  assert.equal((await response.json()).accepted, undefined)
})

test('a provider response without an acceptance ID is not treated as success', async () => {
  const { handler } = setup({
    fetchImpl: async () => new Response('{}', { status: 200 }),
  })
  const response = await handler(makeRequest(validMessage), { ip: '192.0.2.17' })
  assert.equal(response.status, 502)
  assert.equal((await response.json()).accepted, undefined)
})

test('rate limit blocks excess submissions before calling Resend', async () => {
  const { handler, sent } = setup({ rateLimit: async () => false })
  const response = await handler(makeRequest(validMessage), { ip: '192.0.2.13' })
  assert.equal(response.status, 429)
  assert.equal(sent.length, 0)
})

test('rate limiter caps each client at five messages per hour and resets its window', async () => {
  const values = new Map()
  const store = {
    async get(key) { return values.get(key) },
    async setJSON(key, value) { values.set(key, value) },
  }
  const started = Date.UTC(2026, 10, 2, 8)
  for (let count = 0; count < 5; count++) {
    assert.equal(await consumeRateLimit('192.0.2.18', store, started + count), true)
  }
  assert.equal(await consumeRateLimit('192.0.2.18', store, started + 6), false)
  assert.equal(await consumeRateLimit('192.0.2.18', store, started + 60 * 60 * 1000), true)
  assert.equal([...values.keys()][0].includes('192.0.2.18'), false)
})

test('honeypot and foreign origins are rejected', async () => {
  const { handler, sent } = setup()
  const honeypot = await handler(makeRequest({ ...validMessage, website: 'bot-filled-this' }), { ip: '192.0.2.14' })
  const foreign = await handler(makeRequest(validMessage, { origin: 'https://attacker.example' }), { ip: '192.0.2.15' })
  assert.equal(honeypot.status, 400)
  assert.equal(foreign.status, 403)
  assert.equal(sent.length, 0)
})

test('same-origin preflight returns the CORS headers without a response body', async () => {
  const { handler } = setup()
  const response = await handler(makeRequest(null, { method: 'OPTIONS' }))
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://portfolio.example')
  assert.equal(await response.text(), '')
})

test('provider configuration failures return a safe error without leaking credentials', async () => {
  const { handler } = setup({ env: { RESEND_API_KEY: '' } })
  const response = await handler(makeRequest(validMessage), { ip: '192.0.2.16' })
  const body = await response.text()
  assert.equal(response.status, 503)
  assert.equal(body.includes('test-secret-not-for-client'), false)
  assert.equal(body.includes('RESEND_API_KEY'), false)
})
