import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test, { after, before } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore'
import { getBytes, ref, uploadBytes } from 'firebase/storage'

const projectId = 'demo-fitsum-portfolio'
const adminUid = '0SYXtQtU61hMim2S9a2aktAeeSA2'
let testEnvironment

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8280,
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
    storage: {
      host: '127.0.0.1',
      port: 9299,
      rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8'),
    },
  })
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore()
    await setDoc(doc(firestore, 'admins', 'admin-user'), { role: 'admin' })
    await setDoc(doc(firestore, 'drafts', 'projects', 'items', 'draft-project'), {
      status: 'draft',
      visibility: true,
      title: 'Private draft',
    })
    await setDoc(doc(firestore, 'published', 'projects', 'items', 'visible-project'), {
      status: 'published',
      visibility: true,
      order: 0,
      title: 'Visible project',
    })
    await setDoc(doc(firestore, 'published', 'projects', 'items', 'hidden-project'), {
      status: 'published',
      visibility: false,
      order: 1,
      title: 'Hidden project',
    })
    await setDoc(doc(firestore, 'published', 'projects', 'items', 'unpublished-project'), {
      status: 'unpublished',
      visibility: false,
      order: 2,
      title: 'Unpublished project',
    })
    await setDoc(doc(firestore, 'drafts', 'site', 'settings', 'current'), {
      status: 'draft',
      visibility: true,
      name: 'Private settings',
    })
    await setDoc(doc(firestore, 'published', 'site', 'settings', 'current'), {
      status: 'published',
      visibility: true,
      name: 'Public settings',
    })

    await uploadBytes(ref(context.storage(), 'published/projects/visible.png'), new Uint8Array([1, 2, 3]), {
      contentType: 'image/png',
    })
  })
})

after(async () => {
  await testEnvironment?.cleanup()
})

test('public visitors can read only published visible content', async () => {
  const publicDb = testEnvironment.unauthenticatedContext().firestore()
  await assertSucceeds(getDoc(doc(publicDb, 'published', 'projects', 'items', 'visible-project')))
  const visibleProjects = await assertSucceeds(getDocs(query(
    collection(publicDb, 'published', 'projects', 'items'),
    where('status', '==', 'published'),
    where('visibility', '==', true),
    orderBy('order', 'asc'),
  )))
  assert.deepEqual(visibleProjects.docs.map(({ id }) => id), ['visible-project'])
  await assertFails(getDoc(doc(publicDb, 'published', 'projects', 'items', 'hidden-project')))
  await assertFails(getDoc(doc(publicDb, 'published', 'projects', 'items', 'unpublished-project')))
  await assertFails(getDoc(doc(publicDb, 'drafts', 'projects', 'items', 'draft-project')))
  await assertSucceeds(getDoc(doc(publicDb, 'published', 'site', 'settings', 'current')))
  await assertFails(getDoc(doc(publicDb, 'drafts', 'site', 'settings', 'current')))
  await assertFails(setDoc(doc(publicDb, 'published', 'projects', 'items', 'injected'), {
    status: 'published',
    visibility: true,
  }))
  await assertFails(getDoc(doc(publicDb, 'admins', 'admin-user')))
})

test('browser clients cannot read or write drafts, even when Firebase-authenticated', async () => {
  const signedInDb = testEnvironment.authenticatedContext('admin-user').firestore()
  await assertFails(getDoc(doc(signedInDb, 'drafts', 'projects', 'items', 'draft-project')))
  await assertFails(getDoc(doc(signedInDb, 'drafts', 'site', 'settings', 'current')))
  await assertFails(setDoc(doc(signedInDb, 'drafts', 'projects', 'items', 'draft-project'), {
    status: 'draft',
    visibility: true,
    title: 'Updated draft',
  }))
  await assertFails(setDoc(doc(signedInDb, 'published', 'projects', 'items', 'injected'), {
    status: 'published',
    visibility: true,
  }))
})

test('the authorized administrator UID still cannot bypass server-mediated Firestore writes', async () => {
  const adminDb = testEnvironment.authenticatedContext(adminUid).firestore()
  await assertFails(getDoc(doc(adminDb, 'drafts', 'projects', 'items', 'draft-project')))
  await assertFails(setDoc(doc(adminDb, 'drafts', 'projects', 'items', 'draft-project'), {
    status: 'draft',
    visibility: true,
    title: 'Unauthorized direct update',
  }))
  await assertFails(setDoc(doc(adminDb, 'published', 'projects', 'items', 'injected-by-admin'), {
    status: 'published',
    visibility: true,
  }))
})

test('Storage exposes published assets and denies client uploads/deletes', async () => {
  const publicStorage = testEnvironment.unauthenticatedContext().storage()
  const signedInStorage = testEnvironment.authenticatedContext('admin-user').storage()
  const adminStorage = testEnvironment.authenticatedContext(adminUid).storage()

  await assertSucceeds(getBytes(ref(publicStorage, 'published/projects/visible.png')))
  await assertFails(uploadBytes(ref(publicStorage, 'drafts/projects/injected.png'), new Uint8Array([1]), {
    contentType: 'image/png',
  }))
  await assertFails(uploadBytes(ref(signedInStorage, 'drafts/projects/injected.png'), new Uint8Array([1]), {
    contentType: 'image/png',
  }))
  await assertFails(uploadBytes(ref(signedInStorage, 'published/projects/injected.webp'), new Uint8Array([1]), {
    contentType: 'image/webp',
  }))
  await assertFails(uploadBytes(ref(adminStorage, 'published/projects/injected-by-admin.webp'), new Uint8Array([1]), {
    contentType: 'image/webp',
  }))
})
