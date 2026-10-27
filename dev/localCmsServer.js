import { createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createDefaultContentState } from '../src/data/defaultContent.js'
import { contentSchemas, parseContent, siteSettingsSchema } from '../src/lib/db/contentSchemas.js'
import { isValidPdfDocument } from '../src/lib/db/pdfValidation.js'

const COLLECTIONS = Object.keys(contentSchemas)
const MEDIA_COLLECTION = 'media'
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_PDF_BYTES = 5 * 1024 * 1024
const JSON_LIMIT = 2 * 1024 * 1024
const FIREBASE_PROJECT_ID = 'user-auth-vp'
const DEFAULT_ADMIN_UID = '0SYXtQtU61hMim2S9a2aktAeeSA2'
const FIREBASE_KEYS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
const timestamp = () => ({ seconds: Math.floor(Date.now() / 1000) })
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value))
let firebaseKeysCache = { expiresAt: 0, keys: [] }
const metadataKeys = new Set([
  'id', 'status', 'revision', 'publishedRevision', 'basePublishedRevision',
  'createdAt', 'updatedAt', 'updatedBy', 'publishedAt', 'publishedBy', 'deletedAt',
])

class CmsRequestError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

function decodeJwtPart(value) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw new CmsRequestError('Administrator session is invalid. Sign in again.', 401)
  }
}

async function firebaseSigningKeys(fetchImpl) {
  if (firebaseKeysCache.expiresAt > Date.now() && firebaseKeysCache.keys.length) return firebaseKeysCache.keys
  let response
  try {
    response = await fetchImpl(FIREBASE_KEYS_URL, { headers: { Accept: 'application/json' } })
  } catch {
    throw new CmsRequestError('Could not verify the administrator session. Check your connection and retry.', 503)
  }
  if (!response.ok) throw new CmsRequestError('Could not verify the administrator session. Try again shortly.', 503)
  const body = await response.json().catch(() => null)
  if (!Array.isArray(body?.keys) || !body.keys.length) {
    throw new CmsRequestError('Firebase returned invalid signing keys. Try again shortly.', 503)
  }
  const maxAge = Number(/max-age=(\d+)/i.exec(response.headers.get('cache-control') || '')?.[1] || 3600)
  firebaseKeysCache = { expiresAt: Date.now() + Math.min(maxAge, 3600) * 1000, keys: body.keys }
  return firebaseKeysCache.keys
}

export async function verifyAdminToken(token, allowedUids, fetchImpl = fetch) {
  if (typeof token !== 'string' || !token) throw new CmsRequestError('Sign in with the administrator account to continue.', 401)
  const parts = token.split('.')
  if (parts.length !== 3) throw new CmsRequestError('Administrator session is invalid. Sign in again.', 401)
  const header = decodeJwtPart(parts[0])
  const claims = decodeJwtPart(parts[1])
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new CmsRequestError('Administrator session is invalid. Sign in again.', 401)
  }
  let keys = await firebaseSigningKeys(fetchImpl)
  let jwk = keys.find((key) => key.kid === header.kid)
  if (!jwk) {
    firebaseKeysCache.expiresAt = 0
    keys = await firebaseSigningKeys(fetchImpl)
    jwk = keys.find((key) => key.kid === header.kid)
    if (!jwk) throw new CmsRequestError('Administrator session is invalid. Sign in again.', 401)
  }
  let signatureValid = false
  try {
    signatureValid = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(parts[2], 'base64url'),
    )
  } catch {
    throw new CmsRequestError('Administrator session is invalid. Sign in again.', 401)
  }
  const now = Math.floor(Date.now() / 1000)
  const uid = String(claims.sub || '')
  const validClaims = signatureValid
    && claims.aud === FIREBASE_PROJECT_ID
    && claims.iss === `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`
    && uid.length > 0
    && uid.length <= 128
    && claims.user_id === uid
    && Number.isFinite(claims.iat)
    && Number.isFinite(claims.exp)
    && claims.iat <= now
    && claims.exp > now
    && Number.isFinite(claims.auth_time)
    && claims.auth_time <= now
  const admins = Array.isArray(allowedUids) ? allowedUids : String(allowedUids || '').split(',')
  if (!validClaims || !admins.map((value) => String(value).trim()).includes(uid)) {
    throw new CmsRequestError('This account is not authorized to access the portfolio admin.', 403)
  }
  return uid
}

function contentFrom(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !metadataKeys.has(key)))
}

function validateState(state) {
  if (state?.schemaVersion !== 2 || !state.drafts || !state.published || !state.settings) return false
  return COLLECTIONS.every((type) => Array.isArray(state.drafts[type]) && Array.isArray(state.published[type]))
}

function safeFileName(value) {
  const basename = path.basename(String(value || 'upload').replaceAll('\\', '/'))
  const safe = basename.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
  return safe || 'upload'
}

function fileSignature(buffer, mimeType) {
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mimeType === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  return false
}

function localAssetPath(storagePath) {
  if (!/^uploads\/[a-z0-9-]+\/[a-zA-Z0-9._-]+$/.test(storagePath || '')) return ''
  return `/__local-cms/${storagePath.split('/').map(encodeURIComponent).join('/')}`
}

export function createLocalCmsStore(dataDirectory) {
  const contentFile = path.join(dataDirectory, 'content.json')
  const uploadDirectory = path.join(dataDirectory, 'uploads')
  let statePromise
  let queue = Promise.resolve()

  async function initialize() {
    if (!statePromise) {
      statePromise = (async () => {
        await mkdir(uploadDirectory, { recursive: true })
        try {
          const parsed = JSON.parse(await readFile(contentFile, 'utf8'))
          if (!validateState(parsed)) throw new Error('Local CMS JSON has an unsupported structure.')
          return parsed
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
          const initial = createDefaultContentState()
          await persist(initial)
          return initial
        }
      })().catch((error) => {
        statePromise = null
        throw error
      })
    }
    return statePromise
  }

  async function persist(value) {
    await mkdir(dataDirectory, { recursive: true })
    const temporary = `${contentFile}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporary, contentFile)
  }

  function mutate(operation) {
    const next = queue.then(async () => {
      const current = await initialize()
      const working = clone(current)
      const result = await operation(working)
      await persist(working)
      statePromise = Promise.resolve(working)
      return clone(result)
    })
    queue = next.catch(() => {})
    return next
  }

  function currentRecord(current, type, id) {
    return current.drafts[type].find((item) => item.id === id)
      || current.published[type].find((item) => item.id === id)
      || null
  }

  function checkSlug(current, slug, id) {
    const duplicate = [...current.drafts.projects, ...current.published.projects]
      .some((item) => item.id !== id && item.slug === slug && item.status !== 'deleted')
    if (duplicate) throw new CmsRequestError('This project slug is already in use.', 409)
  }

  function buildDraft(current, type, id, content, expectedRevision) {
    const value = parseContent(type, content)
    if (type === 'projects') checkSlug(current, value.slug, id)
    const oldDraft = current.drafts[type].find((item) => item.id === id)
    const oldPublished = current.published[type].find((item) => item.id === id)
    const previous = oldDraft || oldPublished
    if (Number(previous?.revision || 0) !== Number(expectedRevision)) {
      throw new CmsRequestError('This item changed in another tab. Reload it before saving.', 409)
    }
    const now = timestamp()
    const next = {
      ...value,
      id,
      status: 'draft',
      revision: Number(previous?.revision || 0) + 1,
      publishedRevision: Number(oldDraft?.publishedRevision ?? oldPublished?.revision ?? 0),
      basePublishedRevision: Number(oldPublished?.revision || 0),
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      updatedBy: 'local-filesystem',
    }
    const index = current.drafts[type].findIndex((record) => record.id === id)
    if (index < 0) current.drafts[type].push(next)
    else current.drafts[type][index] = next
    return next
  }

  function mediaUsage(current, storagePath) {
    const usedIn = new Set()
    for (const view of ['drafts', 'published']) {
      for (const project of current[view].projects) {
        if (project.status === 'deleted') continue
        const technologyUses = (project.technologies || []).some((technology) => technology.storagePath === storagePath)
        if (
          project.thumbnailImage?.storagePath === storagePath
          || project.heroImage?.storagePath === storagePath
          || project.gallery?.some((asset) => asset.storagePath === storagePath)
          || technologyUses
        ) {
          usedIn.add(project.title || project.slug || 'Project')
        }
      }
      for (const resume of current[view].resumes) {
        if (resume.status !== 'deleted' && resume.storagePath === storagePath) usedIn.add(`Resume v${resume.version}`)
      }
      for (const experience of current[view].experiences) {
        if (experience.status !== 'deleted' && experience.coverLetter?.storagePath === storagePath) {
          usedIn.add(`${experience.role || experience.company || 'Experience'} cover letter`)
        }
        if (experience.status !== 'deleted' && (experience.logo?.storagePath === storagePath || experience.image?.storagePath === storagePath)) {
          usedIn.add(experience.role || 'Experience image')
        }
      }
      for (const education of current[view].education) {
        if (education.status !== 'deleted' && education.image?.storagePath === storagePath) {
          usedIn.add(education.institution || 'Education image')
        }
      }
    }
    return [...usedIn]
  }

  async function removeFile(storagePath) {
    if (!storagePath?.startsWith('uploads/')) return
    const target = path.resolve(dataDirectory, storagePath)
    if (!target.startsWith(`${path.resolve(uploadDirectory)}${path.sep}`)) return
    await rm(target, { force: true })
  }

  async function upload({ bytes, fileName, mimeType, kind = 'image', alt = '', replaceMediaId = '' }) {
    await initialize()
    const isResume = kind === 'resume'
    const isCoverLetter = kind === 'cover-letter'
    const isPdf = isResume || isCoverLetter
    const allowedTypes = isPdf ? ['application/pdf'] : ['image/jpeg', 'image/png', 'image/webp']
    const limit = isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
    if (!allowedTypes.includes(mimeType)) throw new CmsRequestError(isPdf ? 'Choose a PDF file.' : 'Choose a JPEG, PNG, or WebP image.')
    if (isCoverLetter && !/\.pdf$/i.test(fileName || '')) throw new CmsRequestError('Choose a file with a .pdf extension.', 422)
    if (!bytes.length || bytes.length > limit) throw new CmsRequestError(`File must be larger than 0 bytes and no larger than ${isPdf ? '5 MB' : '12 MB'}.`, 413)
    if (isPdf ? !isValidPdfDocument(new Uint8Array(bytes)) : !fileSignature(bytes, mimeType)) {
      throw new CmsRequestError(isPdf ? 'The selected file is not a structurally valid PDF.' : 'The file contents do not match the selected image format.', 422)
    }

    const safeName = safeFileName(fileName)
    const folder = randomUUID()
    const storagePath = `uploads/${folder}/${safeName}`
    const output = path.resolve(dataDirectory, storagePath)
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, bytes, { flag: 'wx' })
    const url = localAssetPath(storagePath)

    try {
      if (isResume) {
        const current = await initialize()
        const version = 1 + Math.max(0, ...current.drafts.resumes.map((item) => Number(item.version) || 0), ...current.published.resumes.map((item) => Number(item.version) || 0))
        const content = {
          fileUrl: url,
          previewUrl: url,
          storagePath,
          fileName: safeName,
          sizeKB: Math.max(0.01, Number((bytes.length / 1024).toFixed(2))),
          version: String(version),
          notes: 'Stored on this development machine',
          isActive: false,
          visibility: true,
          order: version - 1,
        }
        return await mutate((currentState) => buildDraft(currentState, 'resumes', `resume-${randomUUID()}`, content, 0))
      }

      if (isCoverLetter) {
        return {
          fileName: safeName,
          fileUrl: url,
          previewUrl: url,
          storagePath,
          sizeKB: Math.max(0.01, Number((bytes.length / 1024).toFixed(2))),
        }
      }

      let previousPath = ''
      const result = await mutate((current) => {
        const old = replaceMediaId ? currentRecord(current, 'media', replaceMediaId) : null
        if (replaceMediaId && !old) throw new CmsRequestError('Media item was not found.', 404)
        previousPath = old?.storagePath || ''
        const revision = Number(old?.revision || 0) + 1
        const now = timestamp()
        const content = {
          url,
          storagePath,
          type: 'image',
          sizeBytes: bytes.length,
          fileName: safeName,
          mimeType,
          sourceUrl: '',
          alt: String(alt || old?.alt || '').slice(0, 300),
          usedIn: [],
          visibility: true,
          order: old?.order ?? current.published.media.length,
        }
        const record = { ...content, id: old?.id || `media-${randomUUID()}`, status: 'published', revision, publishedRevision: revision, createdAt: old?.createdAt || now, updatedAt: now, publishedAt: now }
        if (previousPath) {
          for (const view of ['drafts', 'published']) {
            for (const project of current[view].projects) {
              if (project.status === 'deleted') continue
              let changed = false
              const replaceAsset = (asset) => {
                if (asset?.storagePath !== previousPath) return asset
                changed = true
                return { ...asset, url, storagePath, mediaProvider: '' }
              }
              project.thumbnailImage = replaceAsset(project.thumbnailImage)
              project.heroImage = replaceAsset(project.heroImage)
              project.gallery = (project.gallery || []).map(replaceAsset)
              project.technologies = (project.technologies || []).map((technology) => {
                if (technology?.storagePath !== previousPath) return technology
                changed = true
                return { ...technology, logo: url, storagePath, mediaProvider: '' }
              })
              if (changed) {
                project.revision = Number(project.revision || 0) + 1
                project.updatedAt = now
                project.updatedBy = 'local-filesystem'
              }
            }
            for (const type of ['experiences', 'education']) {
              for (const record of current[view][type]) {
                if (record.status === 'deleted') continue
                let changed = false
                const replaceAsset = (asset) => {
                  if (asset?.storagePath !== previousPath) return asset
                  changed = true
                  return { ...asset, url, storagePath, mediaProvider: '' }
                }
                if (type === 'experiences') {
                  record.logo = replaceAsset(record.logo)
                  record.image = replaceAsset(record.image)
                } else {
                  record.image = replaceAsset(record.image)
                }
                if (changed) {
                  record.revision = Number(record.revision || 0) + 1
                  record.updatedAt = now
                  record.updatedBy = 'local-filesystem'
                }
              }
            }
          }
        }
        for (const view of ['drafts', 'published']) {
          const index = current[view].media.findIndex((item) => item.id === record.id)
          if (index < 0) current[view].media.push(clone(record))
          else current[view].media[index] = clone(record)
        }
        return record
      })
      if (previousPath && previousPath !== storagePath) await removeFile(previousPath)
      return result
    } catch (error) {
      await removeFile(storagePath).catch(() => {})
      throw error
    }
  }

  async function publishedRecords(type) {
    const current = await initialize()
    return (current.published[type] || [])
      .filter((item) => item.status === 'published' && item.visibility !== false)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map(clone)
  }

  return {
    dataDirectory,
    async health() {
      await initialize()
      await stat(uploadDirectory)
      return { ok: true, mode: 'local-filesystem', storage: 'local-disk', fileUploads: true }
    },
    async list(type, view = 'drafts') {
      if (!COLLECTIONS.includes(type) && type !== MEDIA_COLLECTION) throw new CmsRequestError('Unsupported content collection.', 404)
      const current = await initialize()
      const records = clone(current[view === 'published' ? 'published' : 'drafts'][type])
      if (type === MEDIA_COLLECTION) return records.filter((record) => record.status !== 'deleted').map((record) => ({ ...record, usedIn: mediaUsage(current, record.storagePath) }))
      return records.sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    },
    async get(type, id, view = 'drafts') {
      if (!COLLECTIONS.includes(type) && type !== MEDIA_COLLECTION) throw new CmsRequestError('Unsupported content collection.', 404)
      const current = await initialize()
      const record = current[view === 'published' ? 'published' : 'drafts'][type].find((item) => item.id === id)
      if (type === MEDIA_COLLECTION && record) return { ...clone(record), usedIn: mediaUsage(current, record.storagePath) }
      return clone(record || null)
    },
    async create(type, content) {
      if (!COLLECTIONS.includes(type)) throw new CmsRequestError('Unsupported content collection.', 404)
      return mutate((current) => buildDraft(current, type, `${type}-${randomUUID()}`, content, 0))
    },
    async save(type, id, content, expectedRevision) {
      if (!COLLECTIONS.includes(type)) throw new CmsRequestError('Unsupported content collection.', 404)
      return mutate((current) => buildDraft(current, type, id, content, expectedRevision))
    },
    async publish(type, id, expectedRevision) {
      if (!COLLECTIONS.includes(type)) throw new CmsRequestError('Unsupported content collection.', 404)
      return mutate((current) => {
        const draft = current.drafts[type].find((item) => item.id === id)
        if (!draft) throw new CmsRequestError('Save a draft before publishing this item.', 404)
        if (draft.revision !== Number(expectedRevision)) throw new CmsRequestError('This item changed in another tab. Reload it before publishing.', 409)
        const content = parseContent(type, contentFrom(draft))
        if (type === 'projects') checkSlug(current, content.slug, id)
        const now = timestamp()
        // Publishing is an explicit request to make this record public again.
        // Unpublish marks its stored content invisible; restore visibility here.
        content.visibility = true
        if (type === 'resumes') {
          for (const view of ['drafts', 'published']) for (const item of current[view].resumes) {
            if (item.id !== id && item.isActive) item.isActive = false
          }
          content.isActive = true
        }
        const published = {
          ...content,
          id,
          status: 'published',
          revision: draft.revision,
          publishedRevision: draft.revision,
          basePublishedRevision: draft.revision,
          createdAt: draft.createdAt,
          updatedAt: now,
          publishedAt: now,
          publishedBy: 'local-filesystem',
        }
        const index = current.published[type].findIndex((item) => item.id === id)
        if (index < 0) current.published[type].push(published)
        else current.published[type][index] = published
        const draftIndex = current.drafts[type].findIndex((item) => item.id === id)
        current.drafts[type][draftIndex] = clone(published)
        return { id, type, revision: published.revision, mode: 'local-filesystem' }
      })
    },
    async unpublish(type, id, expectedRevision) {
      if (!COLLECTIONS.includes(type)) throw new CmsRequestError('Unsupported content collection.', 404)
      return mutate((current) => {
        const matching = ['drafts', 'published'].flatMap((view) => current[view][type].filter((item) => item.id === id))
        if (!matching.length) throw new CmsRequestError('Content item not found.', 404)
        const primary = current.drafts[type].find((item) => item.id === id) || current.published[type].find((item) => item.id === id)
        const alreadyUnpublished = matching.every((item) => item.status === 'unpublished' && item.visibility === false && item.isActive === false)
        if (alreadyUnpublished) return { id, status: 'unpublished', revision: primary.revision, mode: 'local-filesystem' }
        if (expectedRevision !== undefined && Number(primary.revision) !== Number(expectedRevision)) {
          throw new CmsRequestError('This item changed in another tab. Reload it before unpublishing.', 409)
        }
        const now = timestamp()
        const revision = Math.max(...matching.map((item) => Number(item.revision) || 0)) + 1
        for (const item of matching) Object.assign(item, { status: 'unpublished', visibility: false, isActive: false, revision, updatedAt: now })
        return { id, status: 'unpublished', revision, mode: 'local-filesystem' }
      })
    },
    async deleteItem(type, id) {
      if (!COLLECTIONS.includes(type) && type !== MEDIA_COLLECTION) throw new CmsRequestError('Unsupported content collection.', 404)
      let storagePath = ''
      const result = await mutate((current) => {
        const item = currentRecord(current, type, id)
        if (!item) throw new CmsRequestError('Content item not found.', 404)
        if (type === 'media') {
          const usage = mediaUsage(current, item.storagePath)
          if (usage.length) throw new CmsRequestError(`This file is still used by ${usage.join(', ')}.`, 409)
        }
        storagePath = item.storagePath || ''
        const now = timestamp()
        for (const view of ['drafts', 'published']) {
          const record = current[view][type].find((entry) => entry.id === id)
          if (record) Object.assign(record, { status: 'deleted', visibility: false, isActive: false, deletedAt: now, updatedAt: now })
        }
        return { id, status: 'deleted', mode: 'local-filesystem' }
      })
      if (storagePath && !mediaUsage(await initialize(), storagePath).length) await removeFile(storagePath)
      return result
    },
    async reorder(type, items) {
      if (!COLLECTIONS.includes(type) || !Array.isArray(items)) throw new CmsRequestError('Provide a supported collection and ordered items.')
      return mutate((current) => {
        for (const item of items) {
          const record = currentRecord(current, type, item.id)
          if (!record || record.revision !== item.expectedRevision) throw new CmsRequestError('A record changed in another tab. Refresh before reordering.', 409)
        }
        return items.map((item) => {
          const record = currentRecord(current, type, item.id)
          return buildDraft(current, type, item.id, { ...contentFrom(record), order: item.order }, record.revision)
        })
      })
    },
    async getSettings(view = 'drafts') {
      const current = await initialize()
      return clone(current.settings[view === 'published' ? 'published' : 'drafts'])
    },
    async saveSettings(content, expectedRevision = 0) {
      const value = siteSettingsSchema.parse(content)
      return mutate((current) => {
        const previous = current.settings.drafts || current.settings.published
        if (Number(previous?.revision || 0) !== Number(expectedRevision)) throw new CmsRequestError('Portfolio settings changed in another tab. Reload before saving.', 409)
        const now = timestamp()
        const next = {
          ...value,
          id: 'settings',
          status: 'draft',
          revision: Number(previous?.revision || 0) + 1,
          publishedRevision: Number(current.settings.published?.revision || 0),
          basePublishedRevision: Number(current.settings.published?.revision || 0),
          resumeManaged: true,
          visibility: true,
          createdAt: previous?.createdAt || now,
          updatedAt: now,
          updatedBy: 'local-filesystem',
        }
        current.settings.drafts = next
        return next
      })
    },
    async publishSettings(expectedRevision) {
      return mutate((current) => {
        const draft = current.settings.drafts
        if (!draft || draft.revision !== Number(expectedRevision)) throw new CmsRequestError('Save the settings draft before publishing.', 409)
        const now = timestamp()
        current.settings.published = { ...clone(draft), status: 'published', publishedRevision: draft.revision, publishedAt: now, publishedBy: 'local-filesystem', updatedAt: now, visibility: true }
        return { revision: draft.revision, mode: 'local-filesystem' }
      })
    },
    async importImage(sourceUrl, alt = '') {
      let url
      try { url = new URL(sourceUrl) } catch { throw new CmsRequestError('Enter a valid image URL.') }
      if (!['http:', 'https:'].includes(url.protocol)) throw new CmsRequestError('Image URL must use HTTP or HTTPS.')
      return mutate((current) => {
        const id = `media-${randomUUID()}`
        const now = timestamp()
        const record = {
          url: url.href,
          storagePath: `remote/${id}`,
          type: 'image',
          sizeBytes: 1,
          fileName: path.basename(url.pathname) || 'referenced-image',
          mimeType: 'image/remote',
          sourceUrl: url.href,
          alt: String(alt).slice(0, 300),
          usedIn: [],
          visibility: true,
          order: current.published.media.length,
          id,
          status: 'published',
          revision: 1,
          publishedRevision: 1,
          createdAt: now,
          updatedAt: now,
          publishedAt: now,
        }
        current.drafts.media.push(clone(record))
        current.published.media.push(clone(record))
        return record
      })
    },
    upload,
    removeMedia(id) { return this.deleteItem('media', id) },
    publishedRecords,
    async publishedDocument(type, id) {
      const records = await publishedRecords(type)
      return records.find((item) => item.id === id) || null
    },
    async publishedSettings() {
      const current = await initialize()
      const settings = current.settings.published
      return settings?.status === 'published' && settings.visibility !== false ? clone(settings) : null
    },
    async serveUpload(relativePath) {
      const safePath = String(relativePath || '').replace(/^\/+/, '')
      if (!safePath.startsWith('uploads/')) return null
      const target = path.resolve(dataDirectory, safePath)
      if (!target.startsWith(`${path.resolve(uploadDirectory)}${path.sep}`)) return null
      try {
        const contents = await readFile(target)
        const item = await stat(target)
        return { contents, size: item.size, mimeType: mimeForExtension(path.extname(target)) }
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    },
  }
}

function mimeForExtension(extension) {
  return ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' })[extension.toLowerCase()] || 'application/octet-stream'
}

async function readRequest(req, maximum) {
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > maximum) throw new CmsRequestError('Request body exceeds the allowed size.', 413)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function parseMultipart(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '')
  const boundaryText = (match?.[1] || match?.[2] || '').trim()
  if (!boundaryText) throw new CmsRequestError('Multipart upload boundary is missing.')
  const boundary = Buffer.from(`--${boundaryText}`)
  const fields = {}
  let file
  let cursor = 0
  while ((cursor = body.indexOf(boundary, cursor)) !== -1) {
    cursor += boundary.length
    if (body.subarray(cursor, cursor + 2).toString() === '--') break
    if (body.subarray(cursor, cursor + 2).toString() === '\r\n') cursor += 2
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor)
    if (headerEnd < 0) break
    const headerText = body.subarray(cursor, headerEnd).toString('utf8')
    const nextBoundary = body.indexOf(boundary, headerEnd + 4)
    if (nextBoundary < 0) break
    let partEnd = nextBoundary
    if (body.subarray(partEnd - 2, partEnd).toString() === '\r\n') partEnd -= 2
    const content = body.subarray(headerEnd + 4, partEnd)
    const fieldName = /name="([^"]+)"/i.exec(headerText)?.[1]
    const filename = /filename="([^"]*)"/i.exec(headerText)?.[1]
    if (fieldName && filename !== undefined) {
      file = { fileName: filename, mimeType: /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() || 'application/octet-stream', bytes: content }
    } else if (fieldName) {
      fields[fieldName] = content.toString('utf8')
    }
    cursor = nextBoundary
  }
  if (!file) throw new CmsRequestError('Choose a file to upload.')
  return { ...fields, ...file }
}

function json(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(status < 400 ? { data } : { error: data }))
}

function isLoopback(req) {
  const address = req.socket.remoteAddress || ''
  return address === '::1' || address === '127.0.0.1' || address.startsWith('::ffff:127.')
}

export function createLocalCmsPlugin({
  dataDirectory = path.resolve(process.cwd(), '.local-cms'),
  adminUids = process.env.VITE_ADMIN_UIDS || DEFAULT_ADMIN_UID,
  fetchImpl = fetch,
} = {}) {
  const store = createLocalCmsStore(dataDirectory)
  return {
    name: 'local-filesystem-cms',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url || '/', 'http://localhost').pathname
        if (pathname.startsWith('/__local-cms/')) {
          if (!isLoopback(req)) return json(res, 403, 'Local CMS files are only available from this machine.')
          const file = await store.serveUpload(decodeURIComponent(pathname.slice('/__local-cms/'.length)))
          if (!file) return json(res, 404, 'Local upload not found.')
          res.statusCode = 200
          res.setHeader('Content-Type', file.mimeType)
          res.setHeader('Content-Length', String(file.size))
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('X-Content-Type-Options', 'nosniff')
          res.end(file.contents)
          return
        }
        if (pathname !== '/api' && !pathname.startsWith('/api/')) return next()
        if (!isLoopback(req)) return json(res, 403, 'Local CMS API is only available from this machine.')
        if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method || 'GET')) return json(res, 405, 'Method not allowed.')
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const segments = url.pathname.split('/').filter(Boolean)
          if (segments[1] === 'health' && req.method === 'GET') return json(res, 200, await store.health())
          if (segments[1] === 'public' && req.method === 'GET') {
            if (segments[2] === 'settings') return json(res, 200, await store.publishedSettings())
            if (COLLECTIONS.includes(segments[2]) && segments[3]) return json(res, 200, await store.publishedDocument(segments[2], decodeURIComponent(segments[3])))
            if (COLLECTIONS.includes(segments[2])) return json(res, 200, await store.publishedRecords(segments[2]))
          }
          try {
            await verifyAdminToken(req.headers['x-firebase-id-token'], adminUids, fetchImpl)
          } catch (error) {
            const status = Number.isInteger(error?.status) ? error.status : 503
            return json(res, status, error.message || 'Could not verify the administrator session.')
          }
          if (segments[1] === 'settings') {
            if (req.method === 'GET') return json(res, 200, await store.getSettings(url.searchParams.get('view') || 'drafts'))
            if (req.method === 'PUT') {
              const body = JSON.parse((await readRequest(req, JSON_LIMIT)).toString('utf8') || '{}')
              return json(res, 200, await store.saveSettings(body.content, body.expectedRevision))
            }
            if (req.method === 'POST' && segments[2] === 'publish') {
              const body = JSON.parse((await readRequest(req, JSON_LIMIT)).toString('utf8') || '{}')
              return json(res, 200, await store.publishSettings(body.expectedRevision))
            }
          }
          if (segments[1] === MEDIA_COLLECTION && segments.length === 2 && req.method === 'GET') {
            return json(res, 200, await store.list(MEDIA_COLLECTION, url.searchParams.get('view') || 'drafts'))
          }
          if (segments[1] === MEDIA_COLLECTION && segments.length === 3 && req.method === 'GET') {
            return json(res, 200, await store.get(MEDIA_COLLECTION, decodeURIComponent(segments[2]), url.searchParams.get('view') || 'drafts'))
          }
          if (segments[1] === 'media' && segments[2] === 'upload' && req.method === 'POST') {
            const upload = parseMultipart(await readRequest(req, MAX_IMAGE_BYTES + 256 * 1024), req.headers['content-type'])
            const result = await store.upload(upload)
            return json(res, 200, result)
          }
          if (segments[1] === 'media' && segments[2] === 'import' && req.method === 'POST') {
            const body = JSON.parse((await readRequest(req, JSON_LIMIT)).toString('utf8') || '{}')
            return json(res, 200, await store.importImage(body.sourceUrl, body.alt))
          }
          if (segments[1] === 'media' && segments[2] && req.method === 'DELETE') return json(res, 200, await store.removeMedia(decodeURIComponent(segments[2])))
          const type = segments[1]
          if (!COLLECTIONS.includes(type)) return json(res, 404, 'Local CMS route not found.')
          if (segments.length === 2 && req.method === 'GET') return json(res, 200, await store.list(type, url.searchParams.get('view') || 'drafts'))
          if (segments.length === 2 && req.method === 'POST') {
            const body = JSON.parse((await readRequest(req, JSON_LIMIT)).toString('utf8') || '{}')
            return json(res, 201, await store.create(type, body.content))
          }
          if (segments.length === 3 && segments[2] === 'reorder' && req.method === 'PATCH') {
            const body = JSON.parse((await readRequest(req, JSON_LIMIT)).toString('utf8') || '{}')
            return json(res, 200, await store.reorder(type, body.items))
          }
          if (segments.length === 3) {
            const id = decodeURIComponent(segments[2])
            if (req.method === 'GET') return json(res, 200, await store.get(type, id, url.searchParams.get('view') || 'drafts'))
            if (req.method === 'PUT') {
              const body = JSON.parse((await readRequest(req, JSON_LIMIT)).toString('utf8') || '{}')
              return json(res, 200, await store.save(type, id, body.content, body.expectedRevision))
            }
            if (req.method === 'DELETE') return json(res, 200, await store.deleteItem(type, id))
          }
          if (segments.length === 4 && ['publish', 'unpublish'].includes(segments[3]) && req.method === 'POST') {
            const body = JSON.parse((await readRequest(req, JSON_LIMIT)).toString('utf8') || '{}')
            const id = decodeURIComponent(segments[2])
            return json(res, 200, segments[3] === 'publish'
              ? await store.publish(type, id, body.expectedRevision)
              : await store.unpublish(type, id, body.expectedRevision))
          }
          return json(res, 404, 'Local CMS route not found.')
        } catch (error) {
          if (error instanceof SyntaxError) return json(res, 400, 'Request body must contain valid JSON.')
          if (error?.code === 'ENOENT') return json(res, 404, 'Local CMS file not found.')
          const status = Number.isInteger(error?.status) ? error.status : error?.name === 'ZodError' ? 422 : 500
          const message = error?.name === 'ZodError'
            ? error.issues.map((issue) => `${issue.path.join('.') || 'content'}: ${issue.message}`).join(' ')
            : status >= 500 ? 'The local CMS could not complete this request.' : error.message
          if (status >= 500) server.config.logger.error(error)
          return json(res, status, message)
        }
      })
    },
  }
}
