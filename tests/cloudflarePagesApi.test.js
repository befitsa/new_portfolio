import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { handleRequest } from '../functions/api/[[path]].js'

const { DatabaseSync } = await import('node:sqlite').catch(() => ({}))

const configuredEnv = {
  DB: {},
  MEDIA: {},
  FIREBASE_PROJECT_ID: 'portfolio-test',
  FIREBASE_WEB_API_KEY: 'test-web-key',
  CMS_ADMIN_UIDS: 'admin-user',
  MEDIA_SIGNING_SECRET: 'test-signing-secret-that-is-at-least-32-bytes-long',
}

let firebaseTestKeyPair
let firebaseTestPublicKey

async function signedFirebaseToken(uid = 'admin-user') {
  if (!firebaseTestKeyPair) {
    firebaseTestKeyPair = await webcrypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )
    firebaseTestPublicKey = await webcrypto.subtle.exportKey('jwk', firebaseTestKeyPair.publicKey)
    firebaseTestPublicKey.kid = 'test-firebase-key'
  }
  const publicKey = firebaseTestPublicKey
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: publicKey.kid })
  const now = Math.floor(Date.now() / 1000)
  const claims = encode({
    iss: 'https://securetoken.google.com/portfolio-test',
    aud: 'portfolio-test',
    sub: uid,
    iat: now,
    exp: now + 3600,
    auth_time: now,
  })
  const unsigned = `${header}.${claims}`
  const signature = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', firebaseTestKeyPair.privateKey, new TextEncoder().encode(unsigned))
  return {
    token: `${unsigned}.${Buffer.from(signature).toString('base64url')}`,
    jwks: { keys: [publicKey] },
  }
}

function sqliteBinding(database) {
  const statement = (sql, bindings = []) => ({
    async run() {
      const result = database.prepare(sql).run(...bindings)
      return { meta: { changes: Number(result.changes) } }
    },
    async first() {
      return database.prepare(sql).get(...bindings) || null
    },
    async all() {
      return { results: database.prepare(sql).all(...bindings) }
    },
  })
  return {
    prepare(sql) {
      return {
        bind(...bindings) {
          return statement(sql, bindings)
        },
        first: async () => database.prepare(sql).get() || null,
        all: async () => ({ results: database.prepare(sql).all() }),
      }
    },
    async batch(statements) {
      database.exec('BEGIN')
      try {
        const results = []
        for (const item of statements) {
          const result = await item.run()
          results.push(result)
        }
        database.exec('COMMIT')
        return results
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
}

function minimalPdf() {
  let text = '%PDF-1.4\n'
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
  ]
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(text, 'latin1'))
    text += object
  }
  const xrefOffset = Buffer.byteLength(text, 'latin1')
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(text, 'latin1')
}

test('health reports when the persistent storage and auth bindings are missing', async () => {
  const response = await handleRequest(new Request('https://portfolio.pages.dev/api/health'), {})

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { data: { ready: false } })
})

test('health reports ready only when all required Cloudflare bindings are configured', async () => {
  const env = {
    ...configuredEnv,
    DB: { prepare: () => ({ first: async () => ({ ready: 1 }) }) },
    MEDIA: { list: async () => ({ objects: [] }) },
  }
  const response = await handleRequest(new Request('https://portfolio.pages.dev/api/health'), env)

  assert.deepEqual(await response.json(), { data: { ready: true } })
})

test('unconfigured admin requests return an actionable JSON response', async () => {
  const response = await handleRequest(new Request('https://portfolio.pages.dev/api/admin/content/projects'), {})

  assert.equal(response.status, 503)
  assert.match((await response.json()).error, /D1 database, R2 bucket, Firebase project ID/)
})

test('admin endpoints reject requests without a Firebase ID token', async () => {
  const response = await handleRequest(
    new Request('https://portfolio.pages.dev/api/admin/content/projects'),
    configuredEnv,
  )

  assert.equal(response.status, 401)
  assert.match((await response.json()).error, /administrator sign-in required/i)
})

test('unknown API routes return a JSON 404 instead of the SPA document', async () => {
  const response = await handleRequest(new Request('https://portfolio.pages.dev/api/private-secrets'), configuredEnv)

  assert.equal(response.status, 404)
  assert.match(response.headers.get('content-type'), /application\/json/)
})

test('public content reads only the published snapshot from D1', async () => {
  let boundValues
  const publishedRow = {
    id: 'project-1',
    type: 'projects',
    status: 'published',
    revision: 2,
    published_revision: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    published_at: '2026-01-01T12:00:00.000Z',
    author_id: 'admin-user',
    published_by: 'admin-user',
    draft_data: JSON.stringify({ title: 'Private draft title', slug: 'live-project', visibility: true }),
    published_data: JSON.stringify({ title: 'Published title', slug: 'live-project', visibility: true }),
  }
  const env = {
    ...configuredEnv,
    DB: {
      prepare(query) {
        return {
          bind(...values) {
            boundValues = values
            return { all: async () => ({ results: [publishedRow] }) }
          },
        }
      },
    },
  }
  const response = await handleRequest(
    new Request('https://portfolio.pages.dev/api/public/content/projects'),
    env,
  )

  assert.deepEqual(boundValues, ['projects', 'published'])
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control'), /s-maxage=15/)
  assert.deepEqual(await response.json(), {
    data: [{
      title: 'Published title',
      slug: 'live-project',
      visibility: true,
      id: 'project-1',
      status: 'published',
    }],
  })
})

test('public content endpoint does not expose draft-only data', async () => {
  const response = await handleRequest(
    new Request('https://portfolio.pages.dev/api/public/content/projects'),
    {
      ...configuredEnv,
      DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) },
    },
  )

  assert.deepEqual(await response.json(), { data: [] })
})

test('admin writes verify Firebase JWTs and persist validated content to D1', async () => {
  const { token, jwks } = await signedFirebaseToken()
  const originalFetch = globalThis.fetch
  let savedRow
  const env = {
    ...configuredEnv,
    DB: {
      prepare(query) {
        return {
          bind(...values) {
            return {
              async run() {
                savedRow = {
                  id: values[0],
                  type: values[1],
                  status: values[2],
                  revision: 1,
                  published_revision: 0,
                  draft_data: values[3],
                  published_data: null,
                  created_at: values[4],
                  updated_at: values[5],
                  author_id: values[6],
                  published_by: null,
                  published_at: null,
                }
                return { meta: { changes: 1 } }
              },
              async first() { return savedRow },
            }
          },
        }
      },
    },
  }
  globalThis.fetch = async (url) => String(url).includes('service_accounts')
    ? Response.json(jwks)
    : Response.json({ users: [{ localId: 'admin-user', disabled: false }] })
  try {
    const response = await handleRequest(
      new Request('https://portfolio.pages.dev/api/admin/content/experiences', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
        body: JSON.stringify({ content: { role: 'Engineer', company: 'Example', startDate: '2025-01-01' } }),
      }),
      env,
    )
    const result = await response.json()

    assert.equal(response.status, 201)
    assert.equal(result.data.status, 'draft')
    assert.equal(result.data.draftData.role, 'Engineer')
    assert.equal(JSON.parse(savedRow.draft_data).company, 'Example')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('signed-in users outside the administrator allowlist cannot create content', async () => {
  const { token, jwks } = await signedFirebaseToken('visitor')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => String(url).includes('service_accounts')
    ? Response.json(jwks)
    : Response.json({ users: [{ localId: 'visitor', disabled: false }] })
  try {
    const response = await handleRequest(
      new Request('https://portfolio.pages.dev/api/admin/content/experiences', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
        body: JSON.stringify({ content: { role: 'Engineer', company: 'Example', startDate: '2025-01-01' } }),
      }),
      configuredEnv,
    )

    assert.equal(response.status, 401)
    assert.match((await response.json()).error, /not authorized/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('uploads reject file contents that do not match the declared media type', async () => {
  const { token, jwks } = await signedFirebaseToken()
  const originalFetch = globalThis.fetch
  let stored = false
  const env = {
    ...configuredEnv,
    MEDIA: {
      async put() { stored = true },
    },
  }
  globalThis.fetch = async (url) => String(url).includes('service_accounts')
    ? Response.json(jwks)
    : Response.json({ users: [{ localId: 'admin-user', disabled: false }] })
  try {
    const response = await handleRequest(
      new Request('https://portfolio.pages.dev/api/admin/uploads?kind=image', {
        method: 'POST',
        headers: {
          'content-type': 'image/png',
          'x-file-name': 'fake.png',
          'x-firebase-id-token': token,
        },
        body: new TextEncoder().encode('not a PNG image'),
      }),
      env,
    )

    assert.equal(response.status, 422)
    assert.match((await response.json()).error, /contents do not match/)
    assert.equal(stored, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('image uploads persist in R2 and serve through an expiring signed media URL', async () => {
  const { token, jwks } = await signedFirebaseToken()
  const originalFetch = globalThis.fetch
  const uploadedObjects = new Map()
  const env = {
    ...configuredEnv,
    MEDIA: {
      async put(key, body, options) {
        uploadedObjects.set(key, { body: new Uint8Array(body), options })
      },
      async get(key) {
        const object = uploadedObjects.get(key)
        if (!object) return null
        return {
          body: new Response(object.body).body,
          writeHttpMetadata(headers) {
            headers.set('content-type', object.options.httpMetadata.contentType)
          },
        }
      },
    },
  }
  globalThis.fetch = async (url) => String(url).includes('service_accounts')
    ? Response.json(jwks)
    : Response.json({ users: [{ localId: 'admin-user', disabled: false }] })
  try {
    const image = new Uint8Array(readFileSync('public/images/logo.png'))
    const uploadResponse = await handleRequest(
      new Request('https://portfolio.pages.dev/api/admin/uploads?kind=image', {
        method: 'POST',
        headers: {
          'content-type': 'image/png',
          'x-file-name': 'portfolio-logo.png',
          'x-firebase-id-token': token,
        },
        body: image,
      }),
      env,
    )
    const uploadPayload = await uploadResponse.json()
    assert.equal(uploadResponse.status, 201, JSON.stringify(uploadPayload))
    assert.equal(uploadedObjects.size, 1)
    assert.equal(uploadPayload.data.mediaProvider, 'cloudflare-r2')
    assert.equal(uploadedObjects.get(uploadPayload.data.storagePath).options.customMetadata.ownerUid, 'admin-user')

    const mediaResponse = await handleRequest(
      new Request(new URL(uploadPayload.data.url, 'https://portfolio.pages.dev')),
      env,
    )
    assert.equal(mediaResponse.status, 200)
    assert.match(mediaResponse.headers.get('cache-control'), /private/)
    assert.deepEqual(new Uint8Array(await mediaResponse.arrayBuffer()), image)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('valid PDF uploads create a private draft resume in D1 and R2', { skip: !DatabaseSync }, async () => {
  const database = new DatabaseSync(':memory:')
  database.exec(readFileSync('cloudflare/schema.sql', 'utf8'))
  const { token, jwks } = await signedFirebaseToken()
  const originalFetch = globalThis.fetch
  const uploadedObjects = new Map()
  const env = {
    ...configuredEnv,
    DB: sqliteBinding(database),
    MEDIA: {
      async put(key, body, options) {
        uploadedObjects.set(key, { body: new Uint8Array(body), options })
      },
      async head(key) {
        const object = uploadedObjects.get(key)
        return object ? { customMetadata: object.options.customMetadata } : null
      },
    },
  }
  globalThis.fetch = async (url) => String(url).includes('service_accounts')
    ? Response.json(jwks)
    : Response.json({ users: [{ localId: 'admin-user', disabled: false }] })
  try {
    const pdf = minimalPdf()
    const response = await handleRequest(
      new Request('https://portfolio.pages.dev/api/admin/uploads?kind=resume', {
        method: 'POST',
        headers: {
          'content-type': 'application/pdf',
          'x-file-name': 'portfolio-resume.pdf',
          'x-firebase-id-token': token,
        },
        body: pdf,
      }),
      env,
    )
    const payload = await response.json()

    assert.equal(response.status, 201, JSON.stringify(payload))
    assert.equal(payload.data.type, 'resumes')
    assert.equal(payload.data.status, 'draft')
    assert.equal(payload.data.draftData.fileName, 'portfolio-resume.pdf')
    assert.equal(payload.data.draftData.mediaProvider, 'cloudflare-r2')
    assert.equal(uploadedObjects.get(payload.data.draftData.storagePath).options.customMetadata.kind, 'resume')
    assert.equal(database.prepare("SELECT count(*) AS count FROM content_records WHERE type = 'resumes'").get().count, 1)
  } finally {
    globalThis.fetch = originalFetch
    database.close()
  }
})

test('Firebase account lookup rejects disabled or revoked admin sessions', async () => {
  const { token, jwks } = await signedFirebaseToken()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => String(url).includes('service_accounts')
    ? Response.json(jwks)
    : Response.json({ users: [{ localId: 'admin-user', disabled: true, validSince: '9999999999' }] })
  try {
    const response = await handleRequest(
      new Request('https://portfolio.pages.dev/api/admin/content/projects', {
        headers: { 'x-firebase-id-token': token },
      }),
      configuredEnv,
    )

    assert.equal(response.status, 401)
    assert.match((await response.json()).error, /disabled or its sign-in has been revoked/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('D1-backed API persists edits, publishes public data, and unpublishes without losing drafts', { skip: !DatabaseSync }, async () => {
  const database = new DatabaseSync(':memory:')
  database.exec(readFileSync('cloudflare/schema.sql', 'utf8'))
  const { token, jwks } = await signedFirebaseToken()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => String(url).includes('service_accounts')
    ? Response.json(jwks)
    : Response.json({ users: [{ localId: 'admin-user', disabled: false }] })
  const env = {
    ...configuredEnv,
    DB: sqliteBinding(database),
    MEDIA: { list: async () => ({ objects: [] }) },
  }
  const authorized = { 'content-type': 'application/json', 'x-firebase-id-token': token }
  try {
    const createdResponse = await handleRequest(
      new Request('https://portfolio.pages.dev/api/admin/content/projects', {
        method: 'POST',
        headers: authorized,
        body: JSON.stringify({ content: { title: 'Draft title', slug: 'draft-title', synopsis: 'Private draft.' } }),
      }),
      env,
    )
    const created = (await createdResponse.json()).data
    assert.equal(createdResponse.status, 201)
    assert.equal(created.revision, 1)

    const savedResponse = await handleRequest(
      new Request(`https://portfolio.pages.dev/api/admin/content/projects/${created.id}`, {
        method: 'PUT',
        headers: authorized,
        body: JSON.stringify({
          expectedRevision: created.revision,
          content: { title: 'Published title', slug: 'draft-title', synopsis: 'Updated summary.' },
        }),
      }),
      env,
    )
    const saved = (await savedResponse.json()).data
    assert.equal(saved.revision, 2)

    const publishResponse = await handleRequest(
      new Request(`https://portfolio.pages.dev/api/admin/content/projects/${created.id}/publish`, {
        method: 'POST',
        headers: authorized,
        body: JSON.stringify({ expectedRevision: saved.revision }),
      }),
      env,
    )
    const publishedPayload = await publishResponse.json()
    const published = publishedPayload.data
    assert.equal(publishResponse.status, 200, JSON.stringify(publishedPayload))
    assert.equal(published.status, 'published')

    const publicResponse = await handleRequest(
      new Request('https://portfolio.pages.dev/api/public/content/projects'),
      env,
    )
    const publicPayload = await publicResponse.json()
    assert.equal(publicResponse.status, 200, JSON.stringify(publicPayload))
    assert.deepEqual(publicPayload.data.map(({ title, synopsis }) => ({ title, synopsis })), [
      { title: 'Published title', synopsis: 'Updated summary.' },
    ])

    const unpublishResponse = await handleRequest(
      new Request(`https://portfolio.pages.dev/api/admin/content/projects/${created.id}/unpublish`, {
        method: 'POST',
        headers: authorized,
      }),
      env,
    )
    const unpublished = (await unpublishResponse.json()).data
    assert.equal(unpublishResponse.status, 200, JSON.stringify(unpublished))
    assert.equal(unpublished.status, 'draft')
    assert.equal(unpublished.draftData.title, 'Published title')

    const afterUnpublish = await handleRequest(
      new Request('https://portfolio.pages.dev/api/public/content/projects'),
      env,
    )
    assert.deepEqual((await afterUnpublish.json()).data, [])
  } finally {
    globalThis.fetch = originalFetch
    database.close()
  }
})
