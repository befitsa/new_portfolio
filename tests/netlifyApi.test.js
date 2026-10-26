import test from 'node:test'
import assert from 'node:assert/strict'
import { handler, isAllowedAdminUid, publicContent } from '../netlify/functions/api.mjs'

function event(path, method = 'GET', headers = {}) {
  return { path, rawUrl: `https://portfolio.example${path}`, httpMethod: method, headers, body: '' }
}

test('admin endpoints reject requests without a Firebase ID token', async () => {
  const response = await handler(event('/api/admin/content/projects'))
  assert.equal(response.statusCode, 401)
  assert.match(JSON.parse(response.body).error, /administrator sign-in required/i)
})

test('upload signing is also protected by server authentication', async () => {
  const response = await handler(event('/api/admin/uploads/sign', 'POST'))
  assert.equal(response.statusCode, 401)
})

test('unknown API routes do not return a success response', async () => {
  const response = await handler(event('/api/private-secrets'))
  assert.equal(response.statusCode, 404)
})

test('server allowlist accepts the existing admin UID and rejects other accounts', () => {
  assert.equal(isAllowedAdminUid('0SYXtQtU61hMim2S9a2aktAeeSA2'), true)
  assert.equal(isAllowedAdminUid('unlisted-user'), false)
  assert.equal(isAllowedAdminUid('second-admin', 'first-admin, second-admin'), true)
})

test('public content serialization exposes only the published snapshot', () => {
  const record = {
    id: 'case-study', status: 'published',
    draftData: { title: 'Unpublished private edit', secret: 'do not return' },
    publishedData: { title: 'Live title', slug: 'case-study', visibility: true },
  }
  const result = publicContent('projects', record)
  assert.equal(result.title, 'Live title')
  assert.equal('draftData' in result, false)
  assert.equal('secret' in result, false)
})
