import { createHash, randomUUID } from 'node:crypto'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { contentSchemas, siteSettingsSchema, resumeSchema } from '../../src/lib/db/contentSchemas.js'
import { isValidPdfDocument } from '../../src/lib/db/pdfValidation.js'

const ADMIN_UID = '0SYXtQtU61hMim2S9a2aktAeeSA2'
const TYPES = new Set(['projects', 'experiences', 'education', 'resumes'])
const MAX_REQUEST_BYTES = 256 * 1024
const MAX_PDF_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function httpError(status, message) { return Object.assign(new Error(message), { status }) }
function json(statusCode, data, publicCache = false) {
  const cacheControl = publicCache && statusCode < 400 ? 'public, max-age=0, s-maxage=15, stale-while-revalidate=30' : 'no-store'
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cacheControl, 'x-content-type-options': 'nosniff' }, body: JSON.stringify(statusCode >= 400 ? { error: data } : { data }) }
}
function currentConfig() {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME?.trim()
  const key = process.env.CLOUDINARY_API_KEY?.trim()
  const secret = process.env.CLOUDINARY_API_SECRET?.trim()
  let serviceAccount = null
  try { serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || 'null') } catch {}
  return { cloud, key, secret, serviceAccount }
}
function getAdminApp() {
  const { serviceAccount } = currentConfig()
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) throw httpError(503, 'Firebase server credentials are not configured in Netlify.')
  if ((process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id) !== 'user-auth-vp' || serviceAccount.project_id !== 'user-auth-vp') {
    throw httpError(503, 'FIREBASE_PROJECT_ID and its service account must both target user-auth-vp.')
  }
  return getApps().find((app) => app.name === 'portfolio-admin') || initializeApp({ credential: cert(serviceAccount), projectId: 'user-auth-vp' }, 'portfolio-admin')
}
function getDb() { return getFirestore(getAdminApp()) }
function contentCollection(type) { return getDb().collection('portfolioContent').doc(type).collection('items') }
function settingsRef() { return contentCollection('settings').doc('current') }
function projectSlugRef(slug) { return getDb().collection('portfolioProjectSlugs').doc(slug) }
function toISO(value) { return value?.toDate ? value.toDate().toISOString() : value ?? null }
function serializeRecord(snapshot) {
  if (!snapshot?.exists) return null
  const value = snapshot.data()
  return {
    id: snapshot.id, type: value.type, status: value.status, revision: value.revision ?? 0,
    publishedRevision: value.publishedRevision ?? 0, createdAt: toISO(value.createdAt),
    updatedAt: toISO(value.updatedAt), publishedAt: toISO(value.publishedAt),
    authorId: value.authorId || '', publishedBy: value.publishedBy || '',
    draftData: value.draftData ?? null, publishedData: value.publishedData ?? null,
  }
}
function cleanStoredContent(type, content) {
  const schema = type === 'settings' ? siteSettingsSchema : contentSchemas[type]
  if (!schema) throw httpError(404, 'Unknown content type.')
  const parsed = schema.parse(content)
  const stripSignedPreview = (value) => {
    if (Array.isArray(value)) return value.map(stripSignedPreview)
    if (!value || typeof value !== 'object') return value
    const next = { ...value }
    if (next.mediaProvider === 'cloudinary') next.url = ''
    if (next.mediaProvider === 'cloudinary' && 'fileUrl' in next) { next.fileUrl = ''; next.previewUrl = '' }
    for (const key of Object.keys(next)) next[key] = stripSignedPreview(next[key])
    return next
  }
  return stripSignedPreview(parsed)
}
function findCloudinaryIds(value, ids = []) {
  if (Array.isArray(value)) value.forEach((entry) => findCloudinaryIds(entry, ids))
  else if (value && typeof value === 'object') {
    if (value.mediaProvider === 'cloudinary' && typeof value.storagePath === 'string') ids.push(value.storagePath)
    Object.values(value).forEach((entry) => findCloudinaryIds(entry, ids))
  }
  return ids
}
function mediaUrl(type, id, assetId) {
  const query = new URLSearchParams({ type, id, assetId })
  return `/api/public/media?${query.toString()}`
}
export function publicContent(type, record) {
  const content = structuredClone(record.publishedData || {})
  if (type === 'resumes') {
    return {
      ...content, id: record.id, status: 'published', visibility: true,
      fileUrl: content.isActive ? `/api/public/resume?id=${encodeURIComponent(record.id)}` : '',
      previewUrl: content.isActive ? `/api/public/resume?id=${encodeURIComponent(record.id)}&preview=1` : '',
      storagePath: '', mediaProvider: '',
    }
  }
  const applyMedia = (value) => {
    if (Array.isArray(value)) return value.map(applyMedia)
    if (!value || typeof value !== 'object') return value
    const next = { ...value }
    if (next.mediaProvider === 'cloudinary' && next.storagePath) next.url = mediaUrl(type, record.id, next.storagePath)
    for (const key of Object.keys(next)) if (key !== 'url' && key !== 'storagePath') next[key] = applyMedia(next[key])
    if (next.mediaProvider === 'cloudinary') { delete next.storagePath; delete next.mediaProvider; delete next.format }
    return next
  }
  return { ...applyMedia(content), id: record.id, status: 'published', visibility: true }
}
function adminContent(type, record) {
  const data = structuredClone(record.draftData || {})
  const assetIds = findCloudinaryIds(data)
  const expiry = Math.floor(Date.now() / 1000) + 300
  const hydrate = (value) => {
    if (Array.isArray(value)) return value.map(hydrate)
    if (!value || typeof value !== 'object') return value
    const next = { ...value }
    if (next.mediaProvider === 'cloudinary' && next.storagePath) {
      if (type === 'resumes' && next.fileName) {
        next.fileUrl = cloudinaryDownloadUrl(next.storagePath, 'pdf', expiry, true)
        next.previewUrl = cloudinaryDownloadUrl(next.storagePath, 'pdf', expiry, false)
      } else next.url = cloudinaryDeliveryUrl(next.storagePath, next.format || 'jpg', expiry)
    }
    for (const key of Object.keys(next)) if (!['url', 'storagePath', 'fileUrl', 'previewUrl'].includes(key)) next[key] = hydrate(next[key])
    return next
  }
  return { ...record, draftData: hydrate(data), publishedData: record.publishedData ? hydrate(record.publishedData) : null, assetCount: assetIds.length }
}
function originAllowed(event) {
  const origin = event.headers?.origin || event.headers?.Origin
  if (!origin) return true
  const allowed = new Set([process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.SITE_URL, ...(process.env.ALLOWED_ORIGINS || '').split(',')].filter(Boolean).map((value) => value.replace(/\/$/, '')))
  try { return allowed.has(new URL(origin).origin) } catch { return false }
}
function requestPath(event) {
  let path = event.path || new URL(event.rawUrl).pathname
  path = path.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '')
  return path.replace(/\/+$/, '') || '/'
}
export function isAllowedAdminUid(uid, configured = process.env.CMS_ADMIN_UIDS || ADMIN_UID) {
  return new Set(String(configured).split(',').map((value) => value.trim()).filter(Boolean)).has(uid)
}
function readBody(event) {
  const text = event.body || ''
  if (Buffer.byteLength(text) > MAX_REQUEST_BYTES) throw httpError(413, 'The request is too large.')
  if (!text) return {}
  try { return JSON.parse(text) } catch { throw httpError(400, 'Request body must be valid JSON.') }
}
async function requireAdmin(event) {
  const token = event.headers?.['x-firebase-id-token'] || event.headers?.['X-Firebase-Id-Token']
  if (!token) throw httpError(401, 'Firebase administrator sign-in required.')
  if (!originAllowed(event)) throw httpError(403, 'This site origin is not allowed to manage portfolio content.')
  let decoded
  try { decoded = await getAuth(getAdminApp()).verifyIdToken(token, true) } catch { throw httpError(401, 'Firebase administrator sign-in is invalid or expired.') }
  if (!isAllowedAdminUid(decoded.uid)) throw httpError(403, 'This Firebase account is not authorized to manage portfolio content.')
  return decoded
}
function validateRecordType(type) {
  if (!TYPES.has(type)) throw httpError(404, 'Unknown content type.')
  return type
}
function checkRevision(record, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision !== record.revision) throw httpError(409, 'This content changed in another session. Reload it before saving.')
}
async function listRecords(type) {
  validateRecordType(type)
  const snapshot = await contentCollection(type).get()
  return snapshot.docs.map(serializeRecord).filter((record) => record && record.status !== 'deleted').sort((a, b) => Number(a.draftData?.order ?? 0) - Number(b.draftData?.order ?? 0))
}
async function createRecord(type, content, actor) {
  validateRecordType(type)
  const data = cleanStoredContent(type, content)
  const ref = contentCollection(type).doc()
  const timestamp = FieldValue.serverTimestamp()
  await getDb().runTransaction(async (tx) => {
    if (type === 'projects') await assertUniqueSlug(tx, data.slug, ref.id)
    tx.set(ref, { type, status: 'draft', revision: 1, publishedRevision: 0, draftData: data, publishedData: null, createdAt: timestamp, updatedAt: timestamp, publishedAt: null, authorId: actor.uid, publishedBy: '' })
    if (type === 'projects') tx.set(projectSlugRef(data.slug), { id: ref.id, updatedAt: timestamp })
  })
  return serializeRecord(await ref.get())
}
async function saveRecord(type, id, content, expectedRevision) {
  validateRecordType(type)
  const data = cleanStoredContent(type, content)
  const ref = contentCollection(type).doc(id)
  await getDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists || snapshot.get('status') === 'deleted') throw httpError(404, 'Content item was not found.')
    const current = snapshot.data()
    checkRevision(current, expectedRevision)
    if (type === 'projects') await assertUniqueSlug(tx, data.slug, id)
    tx.update(ref, { draftData: data, revision: current.revision + 1, updatedAt: FieldValue.serverTimestamp() })
    if (type === 'projects') {
      const previousDraftSlug = current.draftData?.slug
      if (previousDraftSlug && previousDraftSlug !== data.slug && previousDraftSlug !== current.publishedData?.slug) tx.delete(projectSlugRef(previousDraftSlug))
      tx.set(projectSlugRef(data.slug), { id, updatedAt: FieldValue.serverTimestamp() })
    }
  })
  return serializeRecord(await ref.get())
}
async function assertUniqueSlug(tx, slug, currentId) {
  const ref = projectSlugRef(slug)
  const snapshot = await tx.get(ref)
  if (snapshot.exists && snapshot.get('id') !== currentId) throw httpError(409, 'That project slug is already in use.')
}
async function publishRecord(type, id, expectedRevision, actor) {
  validateRecordType(type)
  const ref = contentCollection(type).doc(id)
  const preflight = serializeRecord(await ref.get())
  if (!preflight || preflight.status === 'deleted') throw httpError(404, 'Content item was not found.')
  if (type === 'resumes' && preflight.draftData?.mediaProvider === 'cloudinary') await assertOwnedCloudinaryAsset(preflight.draftData.storagePath, actor.uid, 'resume')
  if (type !== 'resumes') await Promise.all(findCloudinaryIds(preflight.draftData).map((assetId) => assertOwnedCloudinaryAsset(assetId, actor.uid, 'image')))
  await getDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists || snapshot.get('status') === 'deleted') throw httpError(404, 'Content item was not found.')
    const record = snapshot.data()
    checkRevision(record, expectedRevision)
    if (!record.draftData) throw httpError(422, 'Save a draft before publishing it.')
    if (type === 'projects') await assertUniqueSlug(tx, record.draftData.slug, id)
    if (type === 'resumes' && record.draftData.isActive) {
      const all = await tx.get(contentCollection('resumes'))
      for (const other of all.docs) {
        if (other.id === id || other.get('status') !== 'published' || !other.get('publishedData')?.isActive) continue
        tx.update(other.ref, { publishedData: { ...other.get('publishedData'), isActive: false }, updatedAt: FieldValue.serverTimestamp() })
      }
    }
    tx.update(ref, { status: 'published', publishedData: record.draftData, publishedRevision: record.revision, publishedAt: FieldValue.serverTimestamp(), publishedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() })
    if (type === 'projects') {
      const oldSlug = record.publishedData?.slug
      if (oldSlug && oldSlug !== record.draftData.slug) tx.delete(projectSlugRef(oldSlug))
      tx.set(projectSlugRef(record.draftData.slug), { id, updatedAt: FieldValue.serverTimestamp() })
    }
  })
  return serializeRecord(await ref.get())
}
async function unpublishRecord(type, id) {
  validateRecordType(type)
  const ref = contentCollection(type).doc(id)
  await ref.update({ status: 'unpublished', updatedAt: FieldValue.serverTimestamp() }).catch((error) => {
    if (error.code === 5) throw httpError(404, 'Content item was not found.')
    throw error
  })
  return serializeRecord(await ref.get())
}
async function deleteRecord(type, id) {
  validateRecordType(type)
  const ref = contentCollection(type).doc(id)
  await getDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) throw httpError(404, 'Content item was not found.')
    const record = snapshot.data()
    tx.update(ref, { status: 'deleted', deletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), publishedData: null })
    if (type === 'projects') for (const slug of new Set([record.draftData?.slug, record.publishedData?.slug].filter(Boolean))) tx.delete(projectSlugRef(slug))
  })
  return { id, deleted: true }
}
async function reorderRecords(type, ids) {
  validateRecordType(type)
  if (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => typeof id !== 'string')) throw httpError(422, 'Choose a valid content order.')
  const refs = ids.map((id) => contentCollection(type).doc(id))
  await getDb().runTransaction(async (tx) => {
    const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)))
    snapshots.forEach((snapshot, order) => {
      if (!snapshot.exists || snapshot.get('status') === 'deleted') return
      const record = snapshot.data()
      const draftData = { ...(record.draftData || {}), order }
      const publishedData = record.publishedData ? { ...record.publishedData, order } : null
      tx.update(snapshot.ref, { draftData, publishedData, revision: record.revision + 1, publishedRevision: publishedData ? record.revision + 1 : record.publishedRevision, updatedAt: FieldValue.serverTimestamp() })
    })
  })
  return listRecords(type)
}
async function getSettings() { return serializeRecord(await settingsRef().get()) }
async function saveSettings(content, expectedRevision, actor) {
  const data = siteSettingsSchema.parse(content)
  const ref = settingsRef()
  await getDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    const current = snapshot.exists ? snapshot.data() : { revision: 0 }
    checkRevision(current, expectedRevision)
    tx.set(ref, { type: 'settings', status: current.status || 'draft', revision: current.revision + 1, publishedRevision: current.publishedRevision || 0, draftData: data, publishedData: current.publishedData || null, createdAt: current.createdAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), authorId: current.authorId || actor.uid, publishedAt: current.publishedAt || null })
  })
  return getSettings()
}
async function publishSettings(expectedRevision, actor) {
  const ref = settingsRef()
  await getDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) throw httpError(404, 'Save settings as a draft before publishing them.')
    const record = snapshot.data()
    checkRevision(record, expectedRevision)
    tx.update(ref, { status: 'published', publishedData: record.draftData, publishedRevision: record.revision, publishedAt: FieldValue.serverTimestamp(), publishedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() })
  })
  return getSettings()
}
function cloudinaryConfig() {
  const config = currentConfig()
  if (!config.cloud || !config.key || !config.secret) throw httpError(503, 'Cloudinary credentials are not configured in Netlify.')
  return config
}
function signature(params, secret) {
  const source = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&') + secret
  return createHash('sha1').update(source).digest('hex')
}
function cloudinaryDeliveryUrl(publicId, format, expiresAt) {
  return cloudinaryDownloadUrl(publicId, format, expiresAt, false)
}
function cloudinaryDownloadUrl(publicId, format, expiresAt, attachment) {
  const { cloud, key, secret } = cloudinaryConfig()
  const timestamp = Math.floor(Date.now() / 1000)
  const params = { expires_at: expiresAt, format, public_id: publicId, timestamp, type: 'authenticated', ...(attachment ? { attachment: 'true' } : {}) }
  const sig = signature(params, secret)
  const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_key: key, signature: sig })
  return `https://api.cloudinary.com/v1_1/${cloud}/image/download?${query.toString()}`
}
function safeAssetId(value) {
  const id = String(value || '')
  if (!/^portfolio\/[a-zA-Z0-9_-]+\/[a-z0-9-]{20,40}$/.test(id)) throw httpError(422, 'The Cloudinary media identifier is invalid.')
  return id
}
async function cloudinaryResource(assetId) {
  const { cloud, key, secret } = cloudinaryConfig()
  const encoded = assetId.split('/').map(encodeURIComponent).join('/')
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/resources/image/authenticated/${encoded}?context=true`, { headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw httpError(response.status === 404 ? 404 : 502, response.status === 404 ? 'Cloudinary media was not found.' : 'Cloudinary could not verify the uploaded media.')
  return data
}
async function destroyCloudinaryAsset(assetId) {
  try {
    const { cloud, key, secret } = cloudinaryConfig()
    const timestamp = Math.floor(Date.now() / 1000)
    const params = { public_id: assetId, timestamp, type: 'authenticated' }
    const form = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_key: key, signature: signature(params, secret) })
    await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/destroy`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` }, body: form })
  } catch { /* Rejected files are not published; a failed cleanup can be removed in Cloudinary's Media Library. */ }
}
async function assertOwnedCloudinaryAsset(assetId, uid, kind) {
  const safeId = safeAssetId(assetId)
  const asset = await cloudinaryResource(safeId)
  if (asset.type !== 'authenticated' || asset.resource_type !== 'image' || asset.context?.custom?.admin_uid !== uid || !safeId.startsWith(`portfolio/${uid}/`)) throw httpError(403, 'This Cloudinary asset is not owned by the signed-in administrator.')
  if (kind === 'resume' && asset.format !== 'pdf') throw httpError(422, 'The selected resume asset must be a PDF.')
  return asset
}
async function signUpload(kind, actor) {
  if (!['resume', 'image'].includes(kind)) throw httpError(422, 'Choose an image or PDF upload.')
  const { cloud, key, secret } = cloudinaryConfig()
  const timestamp = Math.floor(Date.now() / 1000)
  const publicId = `portfolio/${actor.uid}/${randomUUID()}`
  const params = { allowed_formats: kind === 'resume' ? 'pdf' : 'jpg,jpeg,png,webp', context: `admin_uid=${actor.uid}`, public_id: publicId, timestamp, type: 'authenticated' }
  return { uploadUrl: `https://api.cloudinary.com/v1_1/${cloud}/image/upload`, fields: { ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_key: key, signature: signature(params, secret) } }
}
async function completeUpload(body, actor) {
  const id = safeAssetId(body.assetId)
  const kind = body.kind === 'resume' ? 'resume' : 'image'
  const asset = await assertOwnedCloudinaryAsset(id, actor.uid, kind)
  const size = Number(asset.bytes || body.bytes || 0)
  if (!size || size > (kind === 'resume' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) { await destroyCloudinaryAsset(id); throw httpError(413, `The ${kind} file exceeds its size limit.`) }
  if (kind === 'resume') {
    const url = cloudinaryDeliveryUrl(id, 'pdf', Math.floor(Date.now() / 1000) + 300)
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok) { await destroyCloudinaryAsset(id); throw httpError(422, 'Cloudinary could not read the uploaded PDF for validation. Check PDF delivery settings.') }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_PDF_BYTES || !isValidPdfDocument(bytes)) { await destroyCloudinaryAsset(id); throw httpError(422, 'The upload is not a structurally valid PDF document.') }
    const ref = contentCollection('resumes').doc()
    const content = resumeSchema.parse({ title: String(body.fileName || 'Resume').replace(/\.pdf$/i, ''), fileName: String(body.fileName || 'resume.pdf').slice(0, 255), sizeKB: Math.ceil(size / 1024), version: '1.0', notes: '', isActive: false, visibility: true, order: Date.now(), fileUrl: '', previewUrl: '', storagePath: id, mediaProvider: 'cloudinary' })
    const now = FieldValue.serverTimestamp()
    await ref.set({ type: 'resumes', status: 'draft', revision: 1, publishedRevision: 0, draftData: content, publishedData: null, createdAt: now, updatedAt: now, publishedAt: null, authorId: actor.uid })
    return adminContent('resumes', serializeRecord(await ref.get()))
  }
  if (!['jpg', 'jpeg', 'png', 'webp'].includes(asset.format)) { await destroyCloudinaryAsset(id); throw httpError(422, 'Only JPEG, PNG, and WebP image files are accepted.') }
  return { storagePath: id, mediaProvider: 'cloudinary', fileName: asset.original_filename || 'portfolio-image', sizeBytes: size, format: asset.format, url: cloudinaryDeliveryUrl(id, asset.format, Math.floor(Date.now() / 1000) + 300) }
}
async function routePublic(event, route, query) {
  const parts = route.split('/').filter(Boolean)
  if (parts[0] === 'content' && parts.length === 2 && event.httpMethod === 'GET') {
    const type = validateRecordType(parts[1])
    const snapshot = await contentCollection(type).where('status', '==', 'published').get()
    return snapshot.docs.map(serializeRecord).filter((record) => record?.publishedData?.visibility !== false && (type !== 'resumes' || record.publishedData?.isActive)).map((record) => publicContent(type, record)).sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
  }
  if (parts[0] === 'content' && parts.length === 3 && event.httpMethod === 'GET') {
    const type = validateRecordType(parts[1])
    const record = serializeRecord(await contentCollection(type).doc(parts[2]).get())
    if (!record || record.status !== 'published' || record.publishedData?.visibility === false) throw httpError(404, 'Published content was not found.')
    return publicContent(type, record)
  }
  if (route === '/settings' && event.httpMethod === 'GET') {
    const record = await getSettings()
    return record?.status === 'published' ? record.publishedData : null
  }
  if (route === '/resume' && event.httpMethod === 'GET') {
    const id = query.get('id')
    const record = id ? serializeRecord(await contentCollection('resumes').doc(id).get()) : (await contentCollection('resumes').where('status', '==', 'published').get()).docs.map(serializeRecord).find((item) => item?.publishedData?.isActive)
    if (!record || record.status !== 'published' || !record.publishedData?.isActive) throw httpError(404, 'No published resume is available.')
    if (record.publishedData.mediaProvider === 'cloudinary') {
      const asset = await assertOwnedCloudinaryAsset(record.publishedData.storagePath, record.authorId, 'resume')
      const url = cloudinaryDownloadUrl(record.publishedData.storagePath, 'pdf', Math.floor(Date.now() / 1000) + 300, query.get('preview') !== '1')
      return { __redirect: url, contentType: asset.format }
    }
    const legacyUrl = record.publishedData.fileUrl
    if (typeof legacyUrl === 'string' && /^https:\/\//i.test(legacyUrl)) return { __redirect: legacyUrl, contentType: 'application/pdf' }
    throw httpError(404, 'The published resume file is not available.')
  }
  if (route === '/media' && event.httpMethod === 'GET') {
    const type = validateRecordType(query.get('type'))
    const id = query.get('id')
    const assetId = safeAssetId(query.get('assetId'))
    const record = serializeRecord(await contentCollection(type).doc(id).get())
    if (!record || record.status !== 'published' || record.publishedData?.visibility === false || !findCloudinaryIds(record.publishedData).includes(assetId)) throw httpError(404, 'Published media was not found.')
    const asset = await cloudinaryResource(assetId)
    if (asset.type !== 'authenticated' || asset.resource_type !== 'image') throw httpError(404, 'Published media was not found.')
    return { __redirect: cloudinaryDownloadUrl(assetId, asset.format, Math.floor(Date.now() / 1000) + 300, false) }
  }
  throw httpError(404, 'Public content route was not found.')
}
async function routeAdmin(event, route, query, actor, body) {
  const parts = route.split('/').filter(Boolean)
  if (route === '/health' && event.httpMethod === 'GET') return { ready: true, projectId: 'user-auth-vp', message: 'Netlify Functions and Firestore are connected.' }
  if (parts[0] === 'uploads' && parts[1] === 'sign' && event.httpMethod === 'POST') return signUpload(body.kind, actor)
  if (parts[0] === 'uploads' && parts[1] === 'complete' && event.httpMethod === 'POST') return completeUpload(body, actor)
  if (route === '/settings' && event.httpMethod === 'GET') return getSettings()
  if (route === '/settings' && event.httpMethod === 'PUT') return saveSettings(body.content, body.expectedRevision, actor)
  if (route === '/settings/publish' && event.httpMethod === 'POST') return publishSettings(body.expectedRevision, actor)
  if (parts[0] === 'media' && event.httpMethod === 'GET') {
    const assetId = safeAssetId(query.get('assetId'))
    const asset = await assertOwnedCloudinaryAsset(assetId, actor.uid, '')
    return { previewUrl: cloudinaryDownloadUrl(assetId, asset.format, Math.floor(Date.now() / 1000) + 300, false) }
  }
  if (parts[0] === 'content' && parts.length === 2 && event.httpMethod === 'GET') return (await listRecords(parts[1])).map((record) => adminContent(parts[1], record))
  if (parts[0] === 'content' && parts.length === 2 && event.httpMethod === 'POST') return createRecord(parts[1], body.content, actor)
  if (parts[0] === 'content' && parts.length === 3 && parts[2] === 'reorder' && event.httpMethod === 'PATCH') return reorderRecords(parts[1], body.ids)
  if (parts[0] === 'content' && parts.length === 3 && event.httpMethod === 'GET') {
    const type = validateRecordType(parts[1])
    const record = serializeRecord(await contentCollection(type).doc(parts[2]).get())
    if (!record || record.status === 'deleted') throw httpError(404, 'Content item was not found.')
    return adminContent(type, record)
  }
  if (parts[0] === 'content' && parts.length === 3 && event.httpMethod === 'PUT') return saveRecord(parts[1], parts[2], body.content, body.expectedRevision)
  if (parts[0] === 'content' && parts.length === 3 && event.httpMethod === 'DELETE') return deleteRecord(parts[1], parts[2])
  if (parts[0] === 'content' && parts.length === 4 && parts[3] === 'publish' && event.httpMethod === 'POST') return publishRecord(parts[1], parts[2], body.expectedRevision, actor)
  if (parts[0] === 'content' && parts.length === 4 && parts[3] === 'unpublish' && event.httpMethod === 'POST') return unpublishRecord(parts[1], parts[2])
  throw httpError(404, 'Admin content route was not found.')
}

export const handler = async (event) => {
  try {
    const route = requestPath(event)
    const query = new URL(event.rawUrl || `https://netlify.local${event.path}`).searchParams
    if (route === '/health' && event.httpMethod === 'GET') {
      try { await getDb().doc('_portfolioSystem/health').get(); cloudinaryConfig(); return json(200, { ready: true, projectId: 'user-auth-vp' }) } catch (error) { return json(503, error.message) }
    }
    if (route.startsWith('/public/')) {
      const result = await routePublic(event, route.slice('/public'.length), query)
      if (result?.__redirect) return { statusCode: 302, headers: { location: result.__redirect, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }, body: '' }
      return json(200, result, true)
    }
    if (route.startsWith('/admin/')) {
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(event.httpMethod)) throw httpError(405, 'Method not allowed.')
      const actor = await requireAdmin(event)
      const body = ['POST', 'PUT', 'PATCH'].includes(event.httpMethod) ? readBody(event) : {}
      const result = await routeAdmin(event, route.slice('/admin'.length), query, actor, body)
      return json(200, result)
    }
    throw httpError(404, 'API route was not found.')
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : error?.name === 'ZodError' ? 422 : 500
    const message = error?.name === 'ZodError' ? error.issues.map((issue) => `${issue.path.join('.') || 'content'}: ${issue.message}`).join(' ') : status >= 500 ? 'The API could not complete this request.' : error.message
    if (status >= 500) console.error('Portfolio API error:', error?.message || 'unknown')
    return json(status, message)
  }
}
