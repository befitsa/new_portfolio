import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyAdminUser } from './adminAuth.js'

const adminUid = 'authorized-admin'

function request(token) {
  return { get: (name) => name === 'x-firebase-id-token' ? token : undefined }
}

test('administrator verification requires an ID token and verifies revocation', async () => {
  let verifiedToken
  const auth = {
    verifyIdToken: async (token, checkRevoked) => {
      verifiedToken = { token, checkRevoked }
      return { uid: adminUid, email: 'admin@example.test' }
    },
  }
  const result = await verifyAdminUser(request('signed-token'), auth, adminUid)
  assert.deepEqual(verifiedToken, { token: 'signed-token', checkRevoked: true })
  assert.deepEqual(result, { sub: adminUid, email: 'admin@example.test' })
})

test('administrator verification rejects missing, invalid, and non-admin tokens', async () => {
  const auth = { verifyIdToken: async (token) => {
    if (token === 'bad-token') throw new Error('private token detail')
    return { uid: 'different-user' }
  } }
  await assert.rejects(verifyAdminUser(request(''), auth, adminUid), { status: 401 })
  await assert.rejects(verifyAdminUser(request('bad-token'), auth, adminUid), {
    status: 401,
    message: 'Firebase administrator sign-in is invalid or expired.',
  })
  await assert.rejects(verifyAdminUser(request('other-user-token'), auth, adminUid), {
    status: 403,
    message: 'This Firebase account is not authorized for the CMS.',
  })
})
