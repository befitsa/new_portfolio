import test from 'node:test'
import assert from 'node:assert/strict'
import { checkCmsHealth } from './cmsHealth.js'

test('reports Firestore and Cloud Storage readiness', async () => {
  const result = await checkCmsHealth({
    checkFirestore: async () => {},
    checkStorage: async () => {},
    projectId: 'portfolio-content',
  })

  assert.equal(result.ok, true)
  assert.equal(result.access, 'verified')
  assert.equal(result.administrator, 'verified')
  assert.equal(result.firestore.ready, true)
  assert.equal(result.storage.ready, true)
  assert.equal(result.projectId, 'portfolio-content')
})

test('keeps the API available for content edits when Cloud Storage is unavailable', async () => {
  const result = await checkCmsHealth({
    checkFirestore: async () => {},
    checkStorage: async () => { throw new Error('private storage details') },
  })

  assert.equal(result.ok, true)
  assert.equal(result.firestore.ready, true)
  assert.equal(result.storage.ready, false)
  assert.match(result.storage.message, /Cloud Storage is unavailable/)
  assert.equal(result.storage.message.includes('private storage details'), false)
})

test('marks the CMS unavailable when its Firestore probe fails', async () => {
  const result = await checkCmsHealth({
    checkFirestore: async () => { throw new Error('private database details') },
    checkStorage: async () => {},
  })

  assert.equal(result.ok, false)
  assert.equal(result.firestore.ready, false)
  assert.match(result.firestore.message, /Firestore is unavailable/)
  assert.equal(result.firestore.message.includes('private database details'), false)
})
