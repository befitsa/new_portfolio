import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CONTACT_ENDPOINT, sendContactMessage } from '../src/services/contactService.js'

const values = {
  name: '  Amina Example ',
  email: ' amina@example.com ',
  subject: ' Website redesign ',
  message: ' I would like to discuss a new portfolio website. ',
  website: '',
}

async function withFetch(fetchImpl, callback) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = fetchImpl
  try {
    return await callback()
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('contact service posts the trimmed form schema to the Netlify function endpoint', async () => {
  assert.equal(CONTACT_ENDPOINT, '/.netlify/functions/contact')
  await withFetch(async (url, options) => {
    assert.equal(url, '/.netlify/functions/contact')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(options.body), {
      name: 'Amina Example',
      email: 'amina@example.com',
      subject: 'Website redesign',
      message: 'I would like to discuss a new portfolio website.',
      website: '',
    })
    return new Response(JSON.stringify({ accepted: true }), { status: 200 })
  }, async () => {
    assert.deepEqual(await sendContactMessage(values), { status: 'sent' })
  })
})

test('contact service preserves distinct validation and provider rejection messages', async () => {
  await withFetch(async () => new Response(JSON.stringify({
    code: 'CONTACT_VALIDATION_FAILED',
    error: 'Please correct the contact fields.',
  }), { status: 422 }), async () => {
    assert.deepEqual(await sendContactMessage(values), {
      status: 'error',
      message: 'Please correct the contact fields.',
    })
  })

  await withFetch(async () => new Response(JSON.stringify({
    code: 'EMAIL_PROVIDER_REJECTED',
    providerStatus: 403,
    error: 'The email provider rejected the message.',
  }), { status: 502 }), async () => {
    assert.deepEqual(await sendContactMessage(values), {
      status: 'error',
      message: 'The email provider rejected the message (HTTP 403). Please try again later or email me directly.',
    })
  })
})

test('contact service explains unexpected HTML or missing-endpoint responses', async () => {
  await withFetch(async () => new Response('<!doctype html>', {
    status: 404,
    headers: { 'Content-Type': 'text/html' },
  }), async () => {
    assert.deepEqual(await sendContactMessage(values), {
      status: 'error',
      message: 'The contact service returned an unexpected response (HTTP 404). Please try again later or email me directly.',
    })
  })
})

test('Netlify rewrites the legacy contact alias before the SPA fallback', async () => {
  const rules = await readFile(new URL('../public/_redirects', import.meta.url), 'utf8')
  const lines = rules.split(/\r?\n/)
  const contactRewrite = lines.findIndex((line) => line.startsWith('/api/contact'))
  const spaFallback = lines.findIndex((line) => line.trim().startsWith('/*'))
  assert.ok(contactRewrite >= 0)
  assert.ok(spaFallback > contactRewrite)
  assert.match(lines[contactRewrite], /\/\.netlify\/functions\/contact\s+200!/)
})
