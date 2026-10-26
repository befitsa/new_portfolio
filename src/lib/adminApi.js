import { useSyncExternalStore } from 'react'
import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { localCmsApi } from '../admin/localCmsStore.js'
import { isPathBasedAdmin } from '../admin/cmsPaths.js'
import { hasProductionCmsProvider, isLocalFilesystemCms } from '../services/cmsProvider.js'
import { auth, db, storage } from './firebase.js'
import { parseContent, siteSettingsSchema } from './db/contentSchemas.js'

const statusLabels = {
  checking: 'Checking local CMS…',
  local: 'Local JSON + disk uploads',
  firebase: 'Firebase production CMS',
  unconfigured: 'Production CMS not configured',
  serverError: 'Local CMS unavailable',
}

const productionMessage = 'Live CMS editing is not configured for this deployment. Use npm run dev for local JSON and disk storage, or add a persistent production CMS provider before editing live content.'
const SYSTEM_FIELDS = new Set(['id', 'status', 'revision', 'publishedRevision', 'basePublishedRevision', 'createdAt', 'updatedAt', 'updatedBy', 'publishedAt', 'publishedBy', 'siteVersion', 'lastPublishedAt'])

function stripSystemFields(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SYSTEM_FIELDS.has(key)))
}

function sanitizeFileName(value) {
  const base = String(value || 'upload').normalize('NFKC').replace(/[\\/\0-\x1F<>:"|?*]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 120)
  return base || 'upload'
}

export function isLocalCmsMode() {
  return isLocalFilesystemCms && isPathBasedAdmin()
}

function getActor() {
  if (!auth?.currentUser) {
    throw new CmsApiError('auth', 'Sign in to the admin dashboard before editing live content.')
  }
  return { sub: auth.currentUser.uid, email: auth.currentUser.email || auth.currentUser.uid }
}

function assertRevision(current, expected, fallbackRevision = 0) {
  if (!Number.isInteger(expected) || expected !== (current?.revision ?? fallbackRevision)) {
    throw new CmsApiError('conflict', 'This item changed since you opened it. Reload and try again.', 409)
  }
}

function docRef(type, view, id) {
  return doc(db, view, type, 'items', id)
}

function collectionRef(type, view) {
  return collection(db, view, type, 'items')
}

function normalizeRecord(snapshot) {
  if (!snapshot.exists()) return null
  return { ...snapshot.data(), id: snapshot.id }
}

async function readRecords(type, view) {
  const result = await getDocs(query(collectionRef(type, view), orderBy('order', 'asc')))
  return result.docs.map((snapshot) => ({ ...snapshot.data(), id: snapshot.id })).sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
}

let apiStatus = isLocalCmsMode()
  ? { state: 'checking', ready: false, storageReady: false, checking: true, label: statusLabels.checking, message: statusLabels.checking, checkedAt: null }
  : { state: 'unconfigured', ready: false, storageReady: false, checking: false, label: statusLabels.unconfigured, message: productionMessage, checkedAt: new Date().toISOString() }
const statusListeners = new Set()

function updateApiStatus(next) {
  apiStatus = { ...next, label: next.label || statusLabels[next.state] || 'CMS unavailable' }
  statusListeners.forEach((listener) => listener())
}

function subscribeApiStatus(listener) {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function useCmsApiStatus() {
  return useSyncExternalStore(subscribeApiStatus, () => apiStatus, () => apiStatus)
}

export class CmsApiError extends Error {
  constructor(state, message, status = 0) {
    super(message)
    this.name = 'CmsApiError'
    this.state = state
    this.status = status
  }
}

const unavailableApi = new Proxy({}, {
  get() {
    return async () => { throw new CmsApiError('unconfigured', productionMessage) }
  },
})

const firebaseCmsApi = {
  list: async (type, view = 'drafts') => readRecords(type, view),
  get: async (type, id, view = 'drafts') => normalizeRecord(await getDoc(docRef(type, view, id))),
  create: async (type, content) => {
    const id = crypto.randomUUID()
    return firebaseCmsApi.save(type, id, content, 0)
  },
  save: async (type, id, content, expectedRevision = 0) => {
    const validated = parseContent(type, content)
    const draftRef = docRef(type, 'drafts', id)
    const publishedRef = docRef(type, 'published', id)
    const actor = getActor()
    return runTransaction(db, async (tx) => {
      const [draftSnap, publishedSnap] = await Promise.all([tx.get(draftRef), tx.get(publishedRef)])
      const current = draftSnap.exists ? draftSnap.data() : null
      const publishedRevision = publishedSnap.exists ? Number(publishedSnap.get('revision') ?? 0) : 0
      assertRevision(current, expectedRevision, publishedRevision)
      if (type === 'projects') {
        const slugRef = doc(db, 'slugRegistry', 'projects', 'slugs', validated.slug)
        const slugSnap = await tx.get(slugRef)
        if (slugSnap.exists && slugSnap.get('projectId') !== id) {
          throw new CmsApiError('conflict', `The slug “${validated.slug}” is already in use.`, 409)
        }
        if (current?.slug && current.slug !== validated.slug) {
          const previousSlugRef = doc(db, 'slugRegistry', 'projects', 'slugs', current.slug)
          const previousSlugSnap = await tx.get(previousSlugRef)
          if (previousSlugSnap.exists && previousSlugSnap.get('projectId') === id) {
            tx.delete(previousSlugRef)
          }
        }
      }
      const revision = Math.max(Number(current?.revision ?? 0), publishedRevision) + 1
      const next = {
        ...validated,
        id,
        status: 'draft',
        revision,
        publishedRevision: Number(current?.publishedRevision ?? publishedRevision),
        basePublishedRevision: publishedRevision,
        createdAt: current?.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: actor.sub,
      }
      tx.set(draftRef, next)
      if (type === 'projects') tx.set(doc(db, 'slugRegistry', 'projects', 'slugs', validated.slug), { projectId: id, slug: validated.slug })
      return { ...next, createdAt: next.createdAt, updatedAt: next.updatedAt }
    })
  },
  publish: async (type, id, expectedRevision) => {
    if (!Number.isInteger(expectedRevision)) {
      const draft = await firebaseCmsApi.get(type, id)
      if (!draft) throw new CmsApiError('not_found', 'Draft was not found.', 404)
      expectedRevision = draft.revision
    }
    const draftRef = docRef(type, 'drafts', id)
    const publishedRef = docRef(type, 'published', id)
    const siteRef = doc(db, 'published', 'site', 'settings', 'current')
    const actor = getActor()
    return runTransaction(db, async (tx) => {
      const [draftSnap, publishedSnap, siteSnap] = await Promise.all([tx.get(draftRef), tx.get(publishedRef), tx.get(siteRef)])
      if (!draftSnap.exists) throw new CmsApiError('not_found', 'Draft was not found.', 404)
      const draft = draftSnap.data()
      assertRevision(draft, expectedRevision)
      const currentPublishedRevision = Number(publishedSnap.exists ? publishedSnap.get('revision') ?? 0 : 0)
      if (Number(draft.basePublishedRevision ?? 0) !== currentPublishedRevision) {
        throw new CmsApiError('conflict', 'The published version changed after this draft was started. Reload before publishing.', 409)
      }
      const validated = parseContent(type, stripSystemFields(draft))
      let slugRef
      if (type === 'projects') {
        slugRef = doc(db, 'slugRegistry', 'projects', 'slugs', validated.slug)
        const slugSnap = await tx.get(slugRef)
        if (slugSnap.exists && slugSnap.get('projectId') !== id) {
          throw new CmsApiError('conflict', `The slug “${validated.slug}” is already in use.`, 409)
        }
      }
      const slugDeletions = []
      if (type === 'projects' && publishedSnap.exists && publishedSnap.get('slug') !== validated.slug) {
        const oldSlugRef = doc(db, 'slugRegistry', 'projects', 'slugs', publishedSnap.get('slug'))
        const oldSlugSnap = await tx.get(oldSlugRef)
        if (oldSlugSnap.exists && oldSlugSnap.get('projectId') === id) slugDeletions.push(oldSlugRef)
      }
      const siteVersion = Number(siteSnap.get('siteVersion') ?? 0) + 1
      const publishedAt = serverTimestamp()
      const publication = {
        ...validated,
        id,
        status: 'published',
        revision: Number(draft.revision ?? 1),
        publishedRevision: Number(draft.revision ?? 1),
        publishedAt,
        publishedBy: actor.email || actor.sub,
        updatedAt: serverTimestamp(),
        ...(type === 'resumes' ? { isActive: true } : {}),
      }
      if (slugRef) tx.set(slugRef, { projectId: id, slug: validated.slug })
      for (const oldSlugRef of slugDeletions) tx.delete(oldSlugRef)
      if (type === 'resumes') {
        const resumeQuery = query(collection(db, 'published', 'resumes', 'items'), orderBy('order', 'asc'))
        const resumeDocs = await getDocs(resumeQuery)
        for (const resumeSnap of resumeDocs.docs) {
          if (resumeSnap.id !== id && resumeSnap.data().isActive) {
            tx.update(doc(db, 'published', 'resumes', 'items', resumeSnap.id), { isActive: false, updatedAt: serverTimestamp() })
          }
        }
      }
      tx.set(publishedRef, publication)
      tx.set(draftRef, { ...draft, status: 'published', publishedRevision: publication.revision, basePublishedRevision: publication.revision, publishedAt, updatedAt: serverTimestamp() })
      tx.set(siteRef, {
        ...(siteSnap.exists ? siteSnap.data() : {}),
        status: siteSnap.exists ? siteSnap.get('status') ?? 'published' : 'published',
        visibility: true,
        siteVersion,
        lastPublishedAt: publishedAt,
        updatedAt: serverTimestamp(),
        ...(type === 'resumes' ? { resumeManaged: true } : {}),
      }, { merge: true })
      return { id, type, revision: publication.revision, siteVersion }
    })
  },
  unpublish: async (type, id) => {
    const draftRef = docRef(type, 'drafts', id)
    const publishedRef = docRef(type, 'published', id)
    const siteRef = doc(db, 'published', 'site', 'settings', 'current')
    await runTransaction(db, async (tx) => {
      const [draft, published, site] = await Promise.all([tx.get(draftRef), tx.get(publishedRef), tx.get(siteRef)])
      if (!draft.exists && !published.exists) throw new CmsApiError('not_found', 'Content item was not found.', 404)
      if (published.exists) tx.update(publishedRef, { status: 'unpublished', visibility: false, isActive: false, updatedAt: serverTimestamp() })
      if (draft.exists) tx.update(draftRef, { status: 'unpublished', visibility: false, updatedAt: serverTimestamp() })
      tx.set(siteRef, { ...(site.exists ? site.data() : {}), siteVersion: Number(site.get('siteVersion') ?? 0) + 1, lastPublishedAt: serverTimestamp(), ...(type === 'resumes' ? { resumeManaged: true } : {}) }, { merge: true })
    })
    return { id, status: 'unpublished' }
  },
  deleteItem: async (type, id) => {
    const draftRef = docRef(type, 'drafts', id)
    const publishedRef = docRef(type, 'published', id)
    const siteRef = doc(db, 'published', 'site', 'settings', 'current')
    return runTransaction(db, async (tx) => {
      const [draftSnap, publishedSnap, siteSnap] = await Promise.all([tx.get(draftRef), tx.get(publishedRef), tx.get(siteRef)])
      if (!draftSnap.exists && !publishedSnap.exists) throw new CmsApiError('not_found', 'Content item was not found.', 404)
      const now = serverTimestamp()
      const draftData = draftSnap.exists ? draftSnap.data() : publishedSnap.data()
      const publishedData = publishedSnap.exists ? publishedSnap.data() : draftSnap.data()
      const archive = (data) => ({ ...data, id, status: 'deleted', visibility: false, isActive: false, deletedAt: now, updatedAt: now })
      tx.set(draftRef, archive(draftData))
      tx.set(publishedRef, archive(publishedData))
      if (type === 'projects') {
        const slugRefs = [...new Set([draftData.slug, publishedData.slug].filter(Boolean))].map((slug) => doc(db, 'slugRegistry', 'projects', 'slugs', slug))
        for (const slugRef of slugRefs) {
          const slugSnap = await tx.get(slugRef)
          if (slugSnap.exists && slugSnap.get('projectId') === id) tx.delete(slugRef)
        }
      }
      tx.set(siteRef, { ...(siteSnap.exists ? siteSnap.data() : {}), siteVersion: Number(siteSnap.get('siteVersion') ?? 0) + 1, lastPublishedAt: now, ...(type === 'resumes' ? { resumeManaged: true } : {}) }, { merge: true })
      return { id, status: 'deleted' }
    })
  },
  reorder: async (type, items) => {
    if (!Array.isArray(items) || !items.length || items.length > 200) {
      throw new CmsApiError('validation', 'Provide between 1 and 200 ordered items.', 400)
    }
    const ids = new Set()
    for (const item of items) {
      if (!item?.id || ids.has(item.id) || !Number.isInteger(item.order) || item.order < 0) {
        throw new CmsApiError('validation', 'Each ordered item needs a unique id and non-negative order.', 400)
      }
      ids.add(item.id)
    }
    return runTransaction(db, async (tx) => {
      const refs = items.map((item) => ({ item, draftRef: docRef(type, 'drafts', item.id), publishedRef: docRef(type, 'published', item.id) }))
      const snapshots = await Promise.all(refs.map(async ({ draftRef, publishedRef }) => Promise.all([tx.get(draftRef), tx.get(publishedRef)])))
      const changes = refs.map(({ item, draftRef }, index) => {
        const [draftSnap, publishedSnap] = snapshots[index]
        if (!draftSnap.exists && !publishedSnap.exists) throw new CmsApiError('not_found', `Item ${item.id} was not found.`, 404)
        const current = draftSnap.exists ? draftSnap.data() : publishedSnap.data()
        const currentRevision = Number(current.revision ?? 0)
        if (item.expectedRevision !== currentRevision) throw new CmsApiError('conflict', `Item ${item.id} changed. Reload before reordering.`, 409)
        const publishedRevision = publishedSnap.exists ? Number(publishedSnap.get('revision') ?? 0) : 0
        const content = stripSystemFields(current)
        const revision = Math.max(currentRevision, publishedRevision) + 1
        const next = { ...content, status: 'draft', revision, publishedRevision: Number(current.publishedRevision ?? publishedRevision), basePublishedRevision: publishedRevision, order: item.order, createdAt: current.createdAt ?? serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: getActor().sub }
        tx.set(draftRef, next)
        return { id: item.id, revision: next.revision, status: 'draft', order: next.order }
      })
      return changes
    })
  },
  removeMedia: async (id) => {
    const draftRef = doc(db, 'drafts', 'media', 'items', id)
    const publishedRef = doc(db, 'published', 'media', 'items', id)
    const snapshot = await getDoc(publishedRef)
    const storagePath = snapshot.exists ? snapshot.data().storagePath : null
    if (storagePath) {
      try {
        await deleteObject(ref(storage, storagePath))
      } catch {
        // Keep the content record even when an older storage reference is already missing.
      }
    }
    await Promise.all([deleteDoc(draftRef), deleteDoc(publishedRef)])
    return { id }
  },
  getSettings: async (view = 'drafts') => {
    const snapshot = await getDoc(doc(db, view, 'site', 'settings', 'current'))
    return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null
  },
  saveSettings: async (content, expectedRevision = 0) => {
    const value = siteSettingsSchema.parse(content)
    const draftRef = doc(db, 'drafts', 'site', 'settings', 'current')
    const publishedRef = doc(db, 'published', 'site', 'settings', 'current')
    const actor = getActor()
    return runTransaction(db, async (tx) => {
      const [draftSnap, publishedSnap] = await Promise.all([tx.get(draftRef), tx.get(publishedRef)])
      const current = draftSnap.exists ? draftSnap.data() : null
      const publishedRevision = Number(publishedSnap.get('revision') ?? 0)
      assertRevision(current, expectedRevision, publishedRevision)
      const revision = Math.max(Number(current?.revision ?? 0), publishedRevision) + 1
      const next = { ...value, status: 'draft', revision, publishedRevision: Number(current?.publishedRevision ?? publishedRevision), basePublishedRevision: publishedRevision, createdAt: current?.createdAt ?? serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: actor.sub }
      tx.set(draftRef, next)
      return { ...next, id: 'settings' }
    })
  },
  publishSettings: async (expectedRevision) => {
    const draftRef = doc(db, 'drafts', 'site', 'settings', 'current')
    const publishedRef = doc(db, 'published', 'site', 'settings', 'current')
    const actor = getActor()
    return runTransaction(db, async (tx) => {
      const [draftSnap, publishedSnap] = await Promise.all([tx.get(draftRef), tx.get(publishedRef)])
      if (!draftSnap.exists) throw new CmsApiError('not_found', 'Settings draft was not found.', 404)
      const draft = draftSnap.data()
      assertRevision(draft, expectedRevision)
      const previousRevision = Number(publishedSnap.get('revision') ?? 0)
      if (Number(draft.basePublishedRevision ?? 0) !== previousRevision) throw new CmsApiError('conflict', 'Published settings changed. Reload before publishing.', 409)
      const data = siteSettingsSchema.parse(stripSystemFields(draft))
      const revision = Number(draft.revision ?? 1)
      const siteVersion = Number(publishedSnap.get('siteVersion') ?? 0) + 1
      tx.set(publishedRef, { ...data, status: 'published', visibility: true, revision, publishedRevision: revision, basePublishedRevision: revision, siteVersion, resumeManaged: publishedSnap.get('resumeManaged') === true, publishedAt: serverTimestamp(), updatedAt: serverTimestamp(), publishedBy: actor.email || actor.sub })
      tx.set(draftRef, { ...draft, status: 'published', publishedRevision: revision, basePublishedRevision: revision, updatedAt: serverTimestamp() })
      return { siteVersion, revision }
    })
  },
  importImage: async (sourceUrl, alt = '') => {
    const response = await fetch(sourceUrl, { cache: 'no-store' })
    if (!response.ok) throw new CmsApiError('upload', `Image import failed (${response.status}).`, response.status)
    const blob = await response.blob()
    const file = new File([blob], sanitizeFileName(sourceUrl.split('/').pop() || 'imported-image'), { type: blob.type || 'image/jpeg' })
    return firebaseCmsApi.upload(file, { kind: 'image', alt })
  },
  upload: async (file, { kind = 'image', alt = '', replaceMediaId = '', onProgress = () => {} } = {}) => {
    if (!file) throw new CmsApiError('upload', 'No file was selected.', 400)
    const isResume = kind === 'resume'
    const allowed = isResume ? ['application/pdf'] : ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      throw new CmsApiError('upload', isResume ? 'Choose a PDF resume.' : 'Choose a JPEG, PNG, or WebP image.', 400)
    }
    const actor = getActor()
    const safeName = sanitizeFileName(file.name || (isResume ? 'resume.pdf' : 'image.png'))
    const storagePath = isResume ? `resumes/${crypto.randomUUID()}/${safeName}` : `media/${crypto.randomUUID()}/${safeName}`
    const target = ref(storage, storagePath)
    onProgress(12)
    const arrayBuffer = await file.arrayBuffer()
    await uploadBytes(target, new Uint8Array(arrayBuffer), { contentType: file.type || 'application/octet-stream' })
    onProgress(80)
    const url = await getDownloadURL(target)
    if (isResume) {
      const resumeList = await Promise.all([
        readRecords('resumes', 'drafts'),
        readRecords('resumes', 'published'),
      ])
      const highest = Math.max(0, ...resumeList.flat().map((item) => Number(item.version) || 0))
      const content = {
        fileUrl: url,
        previewUrl: url,
        storagePath,
        fileName: safeName,
        sizeKB: Number((file.size / 1024).toFixed(2)),
        version: String(highest + 1),
        notes: `Uploaded by ${actor.email || actor.sub}`,
        isActive: false,
        visibility: true,
        order: highest,
      }
      const next = await firebaseCmsApi.create('resumes', content)
      return { ...content, ...next, url, storagePath, id: next.id }
    }
    const recordId = replaceMediaId || crypto.randomUUID()
    const currentRecord = replaceMediaId ? await firebaseCmsApi.get('media', replaceMediaId, 'published') : null
    const payload = {
      url,
      storagePath,
      type: 'image',
      sizeBytes: file.size,
      fileName: safeName,
      mimeType: file.type,
      sourceUrl: '',
      alt: String(alt || currentRecord?.alt || '').slice(0, 300),
      usedIn: currentRecord?.usedIn || [],
      visibility: true,
      order: Number(currentRecord?.order ?? Date.now()),
    }
    const revision = Number(currentRecord?.revision ?? 0) + 1
    const record = { ...payload, id: recordId, status: 'published', revision, publishedRevision: revision, createdAt: currentRecord?.createdAt ?? serverTimestamp(), updatedAt: serverTimestamp(), publishedAt: serverTimestamp() }
    const draftRef = doc(db, 'drafts', 'media', 'items', recordId)
    const publishedRef = doc(db, 'published', 'media', 'items', recordId)
    await Promise.all([
      setDoc(publishedRef, record),
      setDoc(draftRef, { ...record, basePublishedRevision: revision, updatedAt: serverTimestamp() }),
    ])
    onProgress(100)
    return { ...payload, id: recordId, url, storagePath }
  },
}

export const adminApi = new Proxy(unavailableApi, {
  get(target, property, receiver) {
    if (isLocalCmsMode() && property in localCmsApi) {
      const value = Reflect.get(localCmsApi, property, localCmsApi)
      return typeof value === 'function' ? value.bind(localCmsApi) : value
    }
    if (hasProductionCmsProvider && property in firebaseCmsApi) {
      const value = Reflect.get(firebaseCmsApi, property, firebaseCmsApi)
      return typeof value === 'function' ? value.bind(firebaseCmsApi) : value
    }
    return Reflect.get(target, property, receiver)
  },
})

export async function checkCmsApiHealth() {
  if (isLocalCmsMode()) {
    updateApiStatus({ state: 'checking', ready: false, checking: true, message: 'Loading local portfolio content…', checkedAt: apiStatus.checkedAt })
    try {
      const health = await localCmsApi.health()
      const note = health.recoveryNotice ? ` ${health.recoveryNotice}` : ''
      updateApiStatus({
        state: 'local',
        ready: true,
        storageReady: true,
        checking: false,
        message: `Development mode: changes are saved in local JSON files and uploads are stored on this machine. They are not published to the live website.${note}`,
        checkedAt: new Date().toISOString(),
      })
      return true
    } catch (cause) {
      const error = cause instanceof CmsApiError
        ? cause
        : new CmsApiError('serverError', cause?.message || 'Local portfolio storage could not be opened.')
      updateApiStatus({
        state: error.state,
        ready: false,
        checking: false,
        message: `${error.message} The admin interface remains available in read-only mode.`,
        checkedAt: new Date().toISOString(),
      })
      return false
    }
  }

  if (hasProductionCmsProvider) {
    updateApiStatus({
      state: 'firebase',
      ready: true,
      storageReady: true,
      checking: false,
      message: 'Production CMS is connected to Firebase. Live edits are saved in Firestore and uploaded files are stored in Firebase Storage.',
      checkedAt: new Date().toISOString(),
    })
    return true
  }

  updateApiStatus({
    state: 'unconfigured',
    ready: false,
    storageReady: false,
    checking: false,
    message: productionMessage,
    checkedAt: new Date().toISOString(),
  })
  return false
}
