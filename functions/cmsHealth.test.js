import test from 'node:test'
import assert from 'node:assert/strict'
import { checkCmsHealth } from './cmsHealth.js'

test('reports readiness only after configuration, Firestore, and Storage checks pass', async () => {
  const result = await checkCmsHealth({
    checkFirestore: async () => {},
    checkStorage: async () => {},
    projectId: 'portfolio-content',
    configurationReady: true,
  })

  assert.equal(result.ok, true)
  assert.equal(result.configuration.ready, true)
  assert.equal(result.firestore.ready, true)
  assert.equal(result.storage.ready, true)
  assert.equal(result.projectId, 'portfolio-content')
})

test('reports Firestore and Storage independently when Storage is unavailable', async () => {
  const result = await checkCmsHealth({
    checkFirestore: async () => {},
    checkStorage: async () => { throw new Error('private storage details') },
    configurationReady: true,
  })

  assert.equal(result.ok, false)
  assert.equal(result.firestore.ready, true)
  assert.equal(result.storage.ready, false)
  assert.match(result.storage.message, /Cloud Storage read\/write access/)
  assert.equal(result.storage.message.includes('private storage details'), false)
})

test('marks the CMS unavailable when Firestore or origin configuration is unavailable', async () => {
  const result = await checkCmsHealth({
    checkFirestore: async () => { throw new Error('private database details') },
    checkStorage: async () => {},
    configurationReady: false,
  })

  assert.equal(result.ok, false)
  assert.equal(result.configuration.ready, false)
  assert.equal(result.firestore.ready, false)
  assert.match(result.firestore.message, /Firestore is unavailable/)
  assert.equal(result.firestore.message.includes('private database details'), false)
})
