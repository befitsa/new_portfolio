import { useSyncExternalStore } from 'react'
import { localCmsApi } from '../admin/localCmsStore.js'
import { auth } from './firebase.js'

export class AdminApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
  }
}

const metadataKeys = new Set([
  'id', 'status', 'revision', 'publishedRevision', 'basePublishedRevision',
  'createdAt', 'updatedAt', 'updatedBy', 'publishedAt', 'publishedBy', 'deletedAt',
])

function contentOf(record) {
  if (!record) return null
  return Object.fromEntries(Object.entries(record).filter(([key]) => !metadataKeys.has(key)))
}

function isoDate(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (Number.isFinite(value.seconds)) return new Date(value.seconds * 1000).toISOString()
  return null
}

function toAdminRecord(type, draft, published) {
  const record = draft || published
  if (!record || record.status === 'deleted') return null
  const draftStatus = draft?.status
  const live = published?.status === 'published'
    && published.visibility !== false
    && !['unpublished', 'deleted'].includes(draftStatus)
    ? published
    : null
  const status = draftStatus === 'draft'
    ? (live ? 'published' : 'draft')
    : live
      ? 'published'
      : draftStatus === 'unpublished' || published?.status === 'unpublished' || record.visibility === false
        ? 'unpublished'
        : record.status
  return {
    id: record.id,
    type,
    status,
    revision: Number(draft?.revision || published?.revision || 0),
    publishedRevision: Number(live?.revision || draft?.publishedRevision || 0),
    createdAt: isoDate(record.createdAt),
    updatedAt: isoDate(draft?.updatedAt || record.updatedAt),
    publishedAt: isoDate(live?.publishedAt),
    draftData: contentOf(draft || published),
    publishedData: contentOf(live),
  }
}

async function getRecord(type, id) {
  const [draft, published] = await Promise.all([
    localCmsApi.get(type, id, 'drafts'),
    localCmsApi.get(type, id, 'published'),
  ])
  return toAdminRecord(type, draft, published)
}

async function listRecords(type) {
  const [drafts, published] = await Promise.all([
    localCmsApi.list(type, 'drafts'),
    localCmsApi.list(type, 'published'),
  ])
  const draftsById = new Map(drafts.map((record) => [record.id, record]))
  const publishedById = new Map(published.map((record) => [record.id, record]))
  return [...new Set([...draftsById.keys(), ...publishedById.keys()])]
    .map((id) => toAdminRecord(type, draftsById.get(id), publishedById.get(id)))
    .filter(Boolean)
}

async function settingsRecord() {
  const [draft, published] = await Promise.all([
    localCmsApi.getSettings('drafts'),
    localCmsApi.getSettings('published'),
  ])
  const record = toAdminRecord('settings', draft, published)
  return record || {
    id: 'current',
    type: 'settings',
    status: 'draft',
    revision: 0,
    publishedRevision: 0,
    draftData: null,
    publishedData: null,
  }
}

function requireLocalDevelopment() {
  if (!import.meta.env.DEV) {
    throw new AdminApiError('The file-based Portfolio Admin is available only in local development. Local changes do not publish to the live website.', 503)
  }
}

async function requireAdmin() {
  requireLocalDevelopment()
  const user = auth?.currentUser
  if (!user) throw new AdminApiError('Sign in with the administrator account to continue.', 401)
  try {
    await user.getIdToken()
  } catch {
    throw new AdminApiError('Your administrator session could not be verified. Sign in again.', 401)
  }
}

const adminApi = {
  async health() {
    requireLocalDevelopment()
    const health = await localCmsApi.health()
    return {
      ready: health.ok === true,
      localOnly: true,
      mode: health.mode,
      storage: health.storage,
    }
  },
  async list(type) { await requireAdmin(); return listRecords(type) },
  async listMedia(view = 'published') { await requireAdmin(); return localCmsApi.list('media', view) },
  async get(type, id) { await requireAdmin(); return getRecord(type, id) },
  async create(type, content) {
    await requireAdmin()
    const record = await localCmsApi.create(type, content)
    return getRecord(type, record.id)
  },
  async save(type, id, content, expectedRevision) {
    await requireAdmin()
    await localCmsApi.save(type, id, content, expectedRevision)
    return getRecord(type, id)
  },
  async publish(type, id, expectedRevision) {
    await requireAdmin()
    await localCmsApi.publish(type, id, expectedRevision)
    return getRecord(type, id)
  },
  async unpublish(type, id, expectedRevision) {
    await requireAdmin()
    await localCmsApi.unpublish(type, id, expectedRevision)
    return getRecord(type, id)
  },
  async delete(type, id) {
    await requireAdmin()
    return localCmsApi.deleteItem(type, id)
  },
  async deleteMedia(id) {
    await requireAdmin()
    return localCmsApi.removeMedia(id)
  },
  async reorder(type, ids) {
    await requireAdmin()
    const records = await listRecords(type)
    const items = ids.map((id, order) => {
      const record = records.find((item) => item.id === id)
      if (!record) throw new AdminApiError('The list changed before it could be reordered. Refresh and try again.', 409)
      return { id, order, expectedRevision: record.revision }
    })
    await localCmsApi.reorder(type, items)
    return listRecords(type)
  },
  async getSettings() { await requireAdmin(); return settingsRecord() },
  async saveSettings(content, expectedRevision) {
    await requireAdmin()
    await localCmsApi.saveSettings(content, expectedRevision)
    return settingsRecord()
  },
  async publishSettings(expectedRevision) {
    await requireAdmin()
    await localCmsApi.publishSettings(expectedRevision)
    return settingsRecord()
  },
}

export { adminApi }

export async function uploadMedia(file, kind = 'image', onProgress = () => {}) {
  await requireAdmin()
  const isPdf = kind === 'resume' || kind === 'cover-letter'
  const limit = isPdf ? 5 * 1024 * 1024 : 8 * 1024 * 1024
  const types = isPdf ? ['application/pdf'] : ['image/jpeg', 'image/png', 'image/webp']
  if (!file || !types.includes(file.type)) {
    throw new AdminApiError(isPdf ? 'Choose a PDF file.' : 'Choose a JPEG, PNG, or WebP image.', 422)
  }
  if (kind === 'cover-letter' && !/\.pdf$/i.test(file.name || '')) {
    throw new AdminApiError('Choose a file with a .pdf extension.', 422)
  }
  if (file.size < 1 || file.size > limit) {
    throw new AdminApiError(`File must be larger than 0 bytes and no larger than ${isPdf ? '5 MB' : '8 MB'}.`, 413)
  }
  const result = await localCmsApi.upload(file, { kind, onProgress })
  if (kind !== 'resume') return result
  return toAdminRecord('resumes', result, null)
}

let apiStatus = {
  state: 'checking',
  ready: false,
  checking: true,
  label: 'Checking local storage',
  message: '',
  localOnly: true,
}
const listeners = new Set()

export function useAdminApiStatus() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    () => apiStatus,
    () => apiStatus,
  )
}

export async function checkAdminApiHealth() {
  apiStatus = { ...apiStatus, state: 'checking', ready: false, checking: true, label: 'Checking local storage', message: '' }
  listeners.forEach((listener) => listener())
  try {
    const health = await adminApi.health()
    apiStatus = health.ready
      ? {
          state: 'ready',
          ready: true,
          checking: false,
          label: 'Local storage ready',
          message: 'Changes are saved on this computer and do not update the live website.',
          localOnly: true,
        }
      : {
          state: 'unavailable',
          ready: false,
          checking: false,
          label: 'Local storage unavailable',
          message: 'Start the application with npm run dev to use local portfolio files.',
          localOnly: true,
        }
  } catch (error) {
    apiStatus = {
      state: 'unavailable',
      ready: false,
      checking: false,
      label: 'Local storage unavailable',
      message: error?.message || 'Start the application with npm run dev to use local portfolio files.',
      localOnly: true,
    }
  }
  listeners.forEach((listener) => listener())
  return apiStatus.ready
}
