import { createDefaultContentState } from '../data/defaultContent.js'
import { normalizeProjectCategory, parseContent, siteSettingsSchema } from '../lib/db/contentSchemas.js'
import { isLegacySeedRecord } from '../lib/db/legacyContent.js'
import { isValidPdfDocument } from '../lib/db/pdfValidation.js'
import { getLocalFileUrl, removeUnusedLocalFiles, storeLocalFile } from './storageService.js'

const CONTENT_KEY = 'fitsum-portfolio-content-v2'
const LEGACY_KEY = 'fitsum-portfolio-cms-local-demo-v1'
const COLLECTIONS = ['projects', 'experiences', 'education', 'resumes', 'media']
const listeners = new Set()
let statePromise
let stateQueue = Promise.resolve()
let lastRecoveryNotice = ''
let broadcastChannel

export class ContentStorageError extends Error {
  constructor(message, cause) {
    super(message, { cause })
    this.name = 'ContentStorageError'
  }
}

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value))
const timestamp = () => ({ seconds: Math.floor(Date.now() / 1000) })
const createId = (type) => `local-${type}-${crypto.randomUUID()}`
const recordsFor = (state, view, type) => state[view][type] || []

function isContentState(value) {
  const hasContentRecords = (records, type) => records.every((record) => {
    if (!record || typeof record.id !== 'string' || !record.id || typeof record.status !== 'string') return false
    try {
      const content = Object.fromEntries(Object.entries(record).filter(([key]) => ![
        'id', 'status', 'revision', 'publishedRevision', 'basePublishedRevision', 'createdAt',
        'updatedAt', 'updatedBy', 'publishedAt', 'publishedBy', 'deletedAt',
      ].includes(key)))
      parseContent(type, content)
      return true
    } catch { return false }
  })
  return value?.schemaVersion === 2
    && value.drafts && value.published
    && COLLECTIONS.every((type) => Array.isArray(value.drafts[type]) && Array.isArray(value.published[type]))
    && COLLECTIONS.every((type) => hasContentRecords(value.drafts[type], type) && hasContentRecords(value.published[type], type))
    && value.settings?.published && value.settings?.drafts
}

function safeOldAsset(record) {
  const next = clone(record)
  const clearUnpersisted = (asset) => {
    if (!asset) return asset
    if (/^blob:/i.test(asset.url || '') || /^https:\/\/local-demo\.invalid\//.test(asset.url || '')) {
      return { ...asset, url: '', storagePath: '' }
    }
    return asset
  }
  if (next.heroImage) next.heroImage = clearUnpersisted(next.heroImage)
  if (Array.isArray(next.gallery)) next.gallery = next.gallery.map(clearUnpersisted)
  if (/^blob:/i.test(next.fileUrl || '') || /^https:\/\/local-demo\.invalid\//.test(next.fileUrl || '')) return null
  if (/^blob:/i.test(next.url || '') || /^https:\/\/local-demo\.invalid\//.test(next.url || '')) return null
  return next
}

function copyLegacyRecords(state, legacy, type) {
  const byId = new Map()
  for (const [view, source] of [['published', 'published'], ['drafts', 'drafts']]) {
    for (const raw of legacy?.[source]?.[type] || []) {
      const item = safeOldAsset(raw)
      if (!item?.id) continue
      if (type === 'projects') item.category = normalizeProjectCategory(item.category)
      const demoSeed = /^demo-/.test(item.id)
      const destination = demoSeed ? 'drafts' : view
      byId.set(item.id, { ...item, status: demoSeed ? 'draft' : item.status || (view === 'published' ? 'published' : 'draft') , __destination: destination })
    }
  }
  for (const [id, item] of byId) {
    const destination = item.__destination
    delete item.__destination
    const existing = state[destination][type].findIndex((record) => record.id === id)
    if (existing >= 0) state[destination][type][existing] = item
    else state[destination][type].push(item)
  }
}

function removeLegacySeedRecords(state) {
  let removed = 0
  for (const type of ['projects', 'education']) {
    for (const view of ['drafts', 'published']) {
      const before = state[view][type].length
      state[view][type] = state[view][type].filter((record) => !isLegacySeedRecord(type, record))
      removed += before - state[view][type].length
    }
  }
  if (removed) lastRecoveryNotice = `Removed ${removed} built-in project or education sample record${removed === 1 ? '' : 's'} from this browser copy.`
  return removed > 0
}

function migrateLegacyState(state) {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return state
    const legacy = JSON.parse(raw)
    for (const type of COLLECTIONS) copyLegacyRecords(state, legacy, type)
    removeLegacySeedRecords(state)
    const oldSettings = legacy?.settings
    if (oldSettings?.published?.name) state.settings.published = { ...state.settings.published, ...safeOldAsset(oldSettings.published), status: 'published', resumeManaged: true }
    if (oldSettings?.drafts?.name) state.settings.drafts = { ...state.settings.published, ...safeOldAsset(oldSettings.drafts), status: 'draft', resumeManaged: true }
    lastRecoveryNotice = [lastRecoveryNotice, 'Previous browser demo data was migrated. Old temporary file previews were discarded because their bytes were not stored.'].filter(Boolean).join(' ')
  } catch {
    lastRecoveryNotice = 'Previous browser demo data could not be read. The existing portfolio content was restored as a new local copy.'
  }
  return state
}

function readStoredState() {
  let raw
  try { raw = localStorage.getItem(CONTENT_KEY) }
  catch (error) { throw new ContentStorageError('Browser storage is unavailable. Enable local storage to edit portfolio content.', error) }
  if (!raw) return null
  let value
  try { value = JSON.parse(raw) } catch { value = null }
  if (isContentState(value)) {
    if (removeLegacySeedRecords(value)) writeStoredState(value)
    return value
  }
  try { localStorage.setItem(`${CONTENT_KEY}.corrupt.${Date.now()}`, raw) } catch { /* Recovery still attempts to restore the original portfolio content. */ }
  lastRecoveryNotice = value
    ? 'Saved browser content used an unsupported format. A recovery copy was kept when possible; supported legacy demo data was migrated.'
    : 'Saved browser content was corrupted. A recovery copy was kept when possible, and a new blank content store was initialized.'
  const recovered = migrateLegacyState(createDefaultContentState())
  removeLegacySeedRecords(recovered)
  writeStoredState(recovered)
  return recovered
}

function writeStoredState(state) {
  try { localStorage.setItem(CONTENT_KEY, JSON.stringify(state)) }
  catch (error) { throw new ContentStorageError('The browser could not save portfolio content. Check storage space and browser privacy settings.', error) }
}

async function loadOrInitialize() {
  const current = readStoredState()
  if (current) return current
  const initial = migrateLegacyState(createDefaultContentState())
  removeLegacySeedRecords(initial)
  writeStoredState(initial)
  return initial
}

export function initializeContentService() {
  if (!statePromise) statePromise = loadOrInitialize().catch((error) => { statePromise = null; throw error })
  return statePromise
}

export function getContentRecoveryNotice() { return lastRecoveryNotice }

function getBroadcastChannel() {
  if (typeof window === 'undefined' || broadcastChannel || typeof BroadcastChannel === 'undefined') return broadcastChannel
  broadcastChannel = new BroadcastChannel('fitsum-portfolio-content')
  broadcastChannel.onmessage = () => refreshFromStorage()
  return broadcastChannel
}

let storageEventBound = false
function bindStorageEvents() {
  if (storageEventBound || typeof window === 'undefined') return
  storageEventBound = true
  window.addEventListener('storage', (event) => {
    if (event.key === CONTENT_KEY || event.key === null) refreshFromStorage()
  })
  getBroadcastChannel()
}

async function notifySubscribers() {
  const state = await initializeContentService()
  for (const subscriber of [...listeners]) {
    try {
      if (subscriber.type === 'settings') {
        const value = state.settings.published
        subscriber.onValue(value?.status === 'published' && value.visibility !== false ? await hydrateRecord(value) : null)
      } else if (subscriber.id) {
        const value = state.published[subscriber.type].find((record) => record.id === subscriber.id)
        subscriber.onValue(value?.status === 'published' && value.visibility !== false ? await hydrateRecord(value) : null)
      } else {
        const values = state.published[subscriber.type]
          .filter((record) => record.status === 'published' && record.visibility !== false)
          .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
        subscriber.onValue(await Promise.all(values.map(hydrateRecord)))
      }
    } catch (error) { subscriber.onError?.(error) }
  }
}

async function refreshFromStorage() {
  try {
    const state = await loadOrInitialize()
    statePromise = Promise.resolve(state)
    await notifySubscribers()
  } catch (error) {
    for (const subscriber of listeners) subscriber.onError?.(error)
  }
}

export function subscribePublishedCollection(type, onValue, onError = () => {}) {
  if (!COLLECTIONS.includes(type)) throw new Error(`Unsupported portfolio collection: ${type}`)
  bindStorageEvents()
  const subscriber = { type, onValue, onError }
  listeners.add(subscriber)
  initializeContentService().then(notifySubscribers).catch(onError)
  return () => listeners.delete(subscriber)
}

export function subscribePublishedDocument(type, id, onValue, onError = () => {}) {
  if (!COLLECTIONS.includes(type)) throw new Error(`Unsupported portfolio collection: ${type}`)
  bindStorageEvents()
  const subscriber = { type, id, onValue, onError }
  listeners.add(subscriber)
  initializeContentService().then(notifySubscribers).catch(onError)
  return () => listeners.delete(subscriber)
}

export function subscribePublishedSettings(onValue, onError = () => {}) {
  bindStorageEvents()
  const subscriber = { type: 'settings', onValue, onError }
  listeners.add(subscriber)
  initializeContentService().then(notifySubscribers).catch(onError)
  return () => listeners.delete(subscriber)
}

async function hydrateRecord(record) {
  const next = clone(record)
  const hydrate = async (asset, field = 'url') => {
    if (!asset?.storagePath?.startsWith('local-assets/')) return asset
    const url = await getLocalFileUrl(asset.storagePath)
    return url ? { ...asset, [field]: url } : { ...asset, [field]: '' }
  }
  if (next.heroImage) next.heroImage = await hydrate(next.heroImage)
  if (Array.isArray(next.gallery)) next.gallery = await Promise.all(next.gallery.map((asset) => hydrate(asset)))
  if (next.fileName && next.version) next.previewUrl ||= next.fileUrl || ''
  if (next.storagePath?.startsWith('local-assets/')) {
    const url = await getLocalFileUrl(next.storagePath)
    if (next.type === 'image') next.url = url || ''
    if (next.fileName && next.version) { next.fileUrl = url || ''; next.previewUrl = url || '' }
  }
  return next
}

async function hydrateRecords(records) { return Promise.all(records.map(hydrateRecord)) }

async function freshState() {
  await initializeContentService()
  try {
    const raw = localStorage.getItem(CONTENT_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return isContentState(parsed) ? parsed : clone(await statePromise)
  } catch (error) {
    throw new ContentStorageError('Browser storage is unavailable. Portfolio content could not be read.', error)
  }
}

function serializeMutation(operation) {
  const next = stateQueue.then(async () => {
    const state = await freshState()
    const result = await operation(state)
    writeStoredState(state)
    statePromise = Promise.resolve(state)
    await notifySubscribers()
    try { getBroadcastChannel()?.postMessage({ type: 'content-changed' }) } catch { /* Other open tabs are an enhancement, not a write requirement. */ }
    return clone(result)
  })
  stateQueue = next.catch(() => {})
  return next
}

function assertUniqueProjectSlug(state, slug, id) {
  const duplicate = [...state.drafts.projects, ...state.published.projects]
    .some((item) => item.id !== id && item.slug === slug && item.status !== 'deleted')
  if (duplicate) throw new Error('This project slug is already in use.')
}

function currentRecord(state, type, id) {
  return state.drafts[type].find((item) => item.id === id) || state.published[type].find((item) => item.id === id) || null
}

function buildDraft(state, type, id, content, expectedRevision) {
  if (!COLLECTIONS.includes(type)) throw new Error(`Unsupported content type: ${type}`)
  const value = parseContent(type, content)
  if (type === 'projects') assertUniqueProjectSlug(state, value.slug, id)
  const previousDraft = state.drafts[type].find((item) => item.id === id)
  const previousPublished = state.published[type].find((item) => item.id === id)
  const current = previousDraft || previousPublished
  const revision = Number(current?.revision || 0)
  if (expectedRevision !== revision) throw new Error('This item changed in another tab. Reload it before saving.')
  const nextRevision = revision + 1
  const now = timestamp()
  const next = {
    ...value,
    id,
    status: 'draft',
    revision: nextRevision,
    publishedRevision: Number(previousDraft?.publishedRevision ?? previousPublished?.revision ?? 0),
    basePublishedRevision: Number(previousPublished?.revision || 0),
    createdAt: current?.createdAt || now,
    updatedAt: now,
    updatedBy: 'local-browser',
  }
  const index = state.drafts[type].findIndex((item) => item.id === id)
  if (index < 0) state.drafts[type].push(next)
  else state.drafts[type][index] = next
  return next
}

function referencesFile(state, storagePath) {
  if (!storagePath) return false
  for (const type of COLLECTIONS) {
    for (const item of [...state.drafts[type], ...state.published[type]]) {
      if (item.id && item.status !== 'deleted' && item.storagePath === storagePath) return true
      if (item.heroImage?.storagePath === storagePath || item.gallery?.some((asset) => asset.storagePath === storagePath)) return true
    }
  }
  return false
}

function mediaUsage(state, mediaId, storagePath) {
  const usedIn = new Set()
  for (const view of ['drafts', 'published']) {
    for (const project of state[view].projects) {
      if (project.status === 'deleted') continue
      if (project.heroImage?.storagePath === storagePath || project.gallery?.some((asset) => asset.storagePath === storagePath)) {
        usedIn.add(project.title || project.slug || 'Project')
      }
    }
    for (const resume of state[view].resumes) {
      if (resume.status !== 'deleted' && resume.storagePath === storagePath) usedIn.add(`Resume v${resume.version}`)
    }
  }
  for (const settings of [state.settings?.drafts, state.settings?.published]) {
    if (settings?.resumeStoragePath === storagePath) usedIn.add('Portfolio settings')
  }
  return [...usedIn]
}

function mapView(record) { return record ? clone(record) : null }

export const contentService = {
  async health() {
    await initializeContentService()
    return { ok: true, mode: 'local-browser-storage', recoveryNotice: lastRecoveryNotice }
  },
  async list(type, view = 'drafts') {
    if (!COLLECTIONS.includes(type)) throw new Error(`Unsupported content type: ${type}`)
    const state = await freshState()
    const records = recordsFor(state, view === 'published' ? 'published' : 'drafts', type)
    const hydrated = await hydrateRecords(records)
    if (type === 'media') {
      return hydrated.map((record) => ({ ...record, usedIn: mediaUsage(state, record.id, record.storagePath) }))
    }
    return hydrated.sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
  },
  async get(type, id, view = 'drafts') {
    if (!COLLECTIONS.includes(type)) throw new Error(`Unsupported content type: ${type}`)
    const state = await freshState()
    const record = recordsFor(state, view === 'published' ? 'published' : 'drafts', type).find((item) => item.id === id)
    return record ? hydrateRecord(record) : null
  },
  async create(type, content) {
    const id = createId(type)
    return serializeMutation((state) => buildDraft(state, type, id, content, 0))
  },
  async save(type, id, content, expectedRevision = 0) {
    return serializeMutation((state) => buildDraft(state, type, id, content, expectedRevision))
  },
  async publish(type, id, expectedRevision) {
    return serializeMutation((state) => {
      if (!COLLECTIONS.includes(type)) throw new Error(`Unsupported content type: ${type}`)
      const draft = state.drafts[type].find((item) => item.id === id)
      if (!draft) throw new Error('Save a draft before publishing this item.')
      if (draft.revision !== expectedRevision) throw new Error('This item changed in another tab. Reload it before publishing.')
      const content = parseContent(type, Object.fromEntries(Object.entries(draft).filter(([key]) => !['id', 'status', 'revision', 'publishedRevision', 'basePublishedRevision', 'createdAt', 'updatedAt', 'updatedBy', 'publishedAt', 'publishedBy'].includes(key))))
      if (type === 'projects') assertUniqueProjectSlug(state, content.slug, id)
      const now = timestamp()
      if (type === 'resumes') {
        for (const view of ['drafts', 'published']) for (const resume of state[view].resumes) {
          if (resume.isActive && resume.id !== id) { resume.isActive = false; resume.updatedAt = now }
        }
      }
      const publication = { ...content, id, status: 'published', revision: draft.revision, publishedRevision: draft.revision, basePublishedRevision: draft.revision, createdAt: draft.createdAt, updatedAt: now, publishedAt: now, publishedBy: 'local-browser' }
      if (type === 'resumes') publication.isActive = true
      const publishedIndex = state.published[type].findIndex((item) => item.id === id)
      if (publishedIndex < 0) state.published[type].push(publication)
      else state.published[type][publishedIndex] = publication
      const draftIndex = state.drafts[type].findIndex((item) => item.id === id)
      state.drafts[type][draftIndex] = clone(publication)
      if (type === 'resumes' && publication.storagePath) state.settings.published.resumeManaged = true
      return { id, type, revision: publication.revision, mode: 'local-browser' }
    })
  },
  async unpublish(type, id) {
    return serializeMutation((state) => {
      if (!COLLECTIONS.includes(type)) throw new Error(`Unsupported content type: ${type}`)
      const matches = ['drafts', 'published'].flatMap((view) => state[view][type].filter((item) => item.id === id))
      if (!matches.length) throw new Error('Content item not found.')
      const now = timestamp()
      for (const item of matches) Object.assign(item, { status: 'unpublished', visibility: false, isActive: false, updatedAt: now })
      return { id, status: 'unpublished', mode: 'local-browser' }
    })
  },
  async deleteItem(type, id) {
    let removedPath = ''
    const result = await serializeMutation((state) => {
      if (!COLLECTIONS.includes(type)) throw new Error(`Unsupported content type: ${type}`)
      const item = currentRecord(state, type, id)
      if (!item) throw new Error('Content item not found.')
      if (type === 'media') {
        const usedIn = mediaUsage(state, item.id, item.storagePath)
        if (usedIn.length) throw new Error(`This file is still used by ${usedIn.join(', ')}.`)
      }
      removedPath = item.storagePath || ''
      const now = timestamp()
      for (const view of ['drafts', 'published']) {
        const record = state[view][type].find((entry) => entry.id === id)
        if (record) Object.assign(record, { status: 'deleted', visibility: false, isActive: false, deletedAt: now, updatedAt: now })
      }
      return { id, status: 'deleted', mode: 'local-browser' }
    })
    if (removedPath && !await hasFileReference(removedPath)) await removeUnusedLocalFiles([removedPath])
    return result
  },
  async reorder(type, items) {
    return serializeMutation((state) => {
      if (!COLLECTIONS.includes(type) || !Array.isArray(items)) throw new Error('Provide a supported collection and ordered items.')
      const changed = []
      for (const item of items) {
        const current = currentRecord(state, type, item.id)
        if (!current || current.revision !== item.expectedRevision) throw new Error('A record changed in another tab. Refresh before reordering.')
        const content = Object.fromEntries(Object.entries(current).filter(([key]) => !['id', 'status', 'revision', 'publishedRevision', 'basePublishedRevision', 'createdAt', 'updatedAt', 'publishedAt', 'publishedBy', 'updatedBy'].includes(key)))
        changed.push(buildDraft(state, type, item.id, { ...content, order: item.order }, current.revision))
      }
      return changed
    })
  },
  async removeMedia(id) { return contentService.deleteItem('media', id) },
  async getSettings(view = 'drafts') {
    const state = await freshState()
    return mapView(state.settings[view === 'published' ? 'published' : 'drafts'])
  },
  async saveSettings(content, expectedRevision = 0) {
    const value = siteSettingsSchema.parse(content)
    return serializeMutation((state) => {
      const previous = state.settings.drafts || state.settings.published
      if (Number(previous?.revision || 0) !== expectedRevision) throw new Error('Portfolio settings changed in another tab. Reload before saving.')
      const now = timestamp()
      const next = { ...value, id: 'settings', status: 'draft', revision: Number(previous?.revision || 0) + 1, publishedRevision: Number(state.settings.published?.revision || 0), basePublishedRevision: Number(state.settings.published?.revision || 0), resumeManaged: true, createdAt: previous?.createdAt || now, updatedAt: now, updatedBy: 'local-browser' }
      state.settings.drafts = next
      return next
    })
  },
  async publishSettings(expectedRevision) {
    return serializeMutation((state) => {
      const draft = state.settings.drafts
      if (!draft || draft.revision !== expectedRevision) throw new Error('Save the portfolio settings draft before previewing publication.')
      const now = timestamp()
      state.settings.published = { ...clone(draft), status: 'published', publishedRevision: draft.revision, publishedAt: now, publishedBy: 'local-browser', updatedAt: now, resumeManaged: true }
      return { revision: draft.revision, mode: 'local-browser' }
    })
  },
  async importImage(sourceUrl, alt = '') {
    let url
    try { url = new URL(sourceUrl) } catch { throw new Error('Enter a valid image URL.') }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Image URL must use HTTP or HTTPS.')
    const state = await freshState()
    const id = createId('media')
    const value = { url: url.href, storagePath: `remote/${id}`, type: 'image', sizeBytes: 1, fileName: url.pathname.split('/').pop() || 'imported-image', mimeType: 'image/remote', sourceUrl: url.href, alt, usedIn: [], visibility: true, order: state.published.media.length }
    const time = timestamp()
    const record = { ...value, id, status: 'published', revision: 1, publishedRevision: 1, createdAt: time, updatedAt: time, publishedAt: time }
    await serializeMutation((current) => { current.drafts.media.push(clone(record)); current.published.media.push(clone(record)); return record })
    return record
  },
  async upload(file, { kind = 'image', alt = '', replaceMediaId = '', onProgress = () => {} } = {}) {
    const maximum = kind === 'resume' ? 5 * 1024 * 1024 : 12 * 1024 * 1024
    if (!(file instanceof Blob)) throw new Error('Choose a local file to upload.')
    if (file.size <= 0 || file.size > maximum) throw new Error(`Choose a file larger than 0 bytes and no larger than ${kind === 'resume' ? '5 MB' : '12 MB'}.`)
    const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer())
    const isJpeg = signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff
    const isPng = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => signature[index] === byte)
    const isWebp = String.fromCharCode(...signature.slice(0, 4)) === 'RIFF' && String.fromCharCode(...signature.slice(8, 12)) === 'WEBP'
    if (kind === 'resume' && !isValidPdfDocument(new Uint8Array(await file.arrayBuffer()))) throw new Error('The selected file is not a valid PDF document.')
    if (kind === 'image' && !((isJpeg && file.type === 'image/jpeg') || (isPng && file.type === 'image/png') || (isWebp && file.type === 'image/webp'))) throw new Error('The file contents do not match a supported JPEG, PNG, or WebP image.')
    if (!['image', 'resume'].includes(kind)) throw new Error('Unsupported local file type.')

    const id = kind === 'resume' ? createId('resume') : (replaceMediaId || createId('media'))
    const storagePath = `local-assets/${crypto.randomUUID()}`
    onProgress(10)
    await storeLocalFile(file, storagePath)
    onProgress(75)
    try {
      if (kind === 'resume') {
        const state = await freshState()
        const version = 1 + Math.max(0, ...state.drafts.resumes.map((item) => Number(item.version) || 0), ...state.published.resumes.map((item) => Number(item.version) || 0))
        const localUrl = `https://local-files.invalid/${encodeURIComponent(storagePath)}`
        const content = { fileUrl: localUrl, previewUrl: localUrl, storagePath, fileName: file.name || `resume-v${version}.pdf`, sizeKB: Math.max(0.01, Number((file.size / 1024).toFixed(2))), version: String(version), notes: 'Stored in this browser', isActive: false, visibility: true, order: version - 1 }
        const created = await serializeMutation((current) => buildDraft(current, 'resumes', id, content, 0))
        onProgress(100)
        return hydrateRecord(created)
      }
      const state = await freshState()
      const existing = replaceMediaId ? currentRecord(state, 'media', replaceMediaId) : null
      const mediaId = existing?.id || id
      const previousStoragePath = existing?.storagePath || ''
      const content = { url: `https://local-files.invalid/${encodeURIComponent(storagePath)}`, storagePath, type: 'image', sizeBytes: file.size, fileName: file.name, mimeType: file.type, sourceUrl: '', alt: alt || existing?.alt || '', usedIn: existing?.usedIn || [], visibility: true, order: existing?.order ?? state.published.media.length }
      const time = timestamp()
      const record = { ...content, id: mediaId, status: 'published', revision: Number(existing?.revision || 0) + 1, publishedRevision: Number(existing?.revision || 0) + 1, createdAt: existing?.createdAt || time, updatedAt: time, publishedAt: time }
      await serializeMutation((current) => {
        if (previousStoragePath && previousStoragePath !== storagePath) {
          const now = timestamp()
          for (const view of ['drafts', 'published']) for (const project of current[view].projects) {
            let changed = false
            const replaceAsset = (asset) => {
              if (asset?.storagePath !== previousStoragePath) return asset
              changed = true
              return { ...asset, url: content.url, storagePath }
            }
            project.heroImage = replaceAsset(project.heroImage)
            project.gallery = (project.gallery || []).map(replaceAsset)
            if (changed) {
              project.revision = Number(project.revision || 0) + 1
              if (view === 'published') {
                project.publishedRevision = project.revision
                project.basePublishedRevision = project.revision
              }
              project.updatedAt = now
              project.updatedBy = 'local-browser'
            }
          }
        }
        for (const view of ['drafts', 'published']) {
          const index = current[view].media.findIndex((item) => item.id === mediaId)
          if (index < 0) current[view].media.push(clone(record))
          else current[view].media[index] = clone(record)
        }
        return record
      })
      if (previousStoragePath && previousStoragePath !== storagePath && !await hasFileReference(previousStoragePath)) await removeUnusedLocalFiles([previousStoragePath])
      onProgress(100)
      return hydrateRecord(record)
    } catch (error) {
      await removeUnusedLocalFiles([storagePath]).catch(() => {})
      throw error
    }
  },
}

async function hasFileReference(storagePath) {
  const state = await freshState()
  return referencesFile(state, storagePath)
}
