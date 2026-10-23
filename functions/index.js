import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { onRequest } from 'firebase-functions/v2/https'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import ipaddr from 'ipaddr.js'
import sharp from 'sharp'
import { Agent } from 'undici'
import { parsePayload, schemas, settingsSchema } from './contentSchemas.js'
import { isValidPdfDocument } from './pdfValidation.js'

if (!getApps().length) initializeApp()
const db = getFirestore()
const bucket = getStorage().bucket()
const ADMIN_AUTH_PROJECT_ID = 'user-auth-vp'
const ADMIN_AUTH_APP_NAME = `admin-auth-${ADMIN_AUTH_PROJECT_ID}`
const adminAuthApp = getApps().find((app) => app.name === ADMIN_AUTH_APP_NAME)
  ?? initializeApp({ projectId: ADMIN_AUTH_PROJECT_ID }, ADMIN_AUTH_APP_NAME)
const adminAuth = getAuth(adminAuthApp)
const TYPES = new Set(Object.keys(schemas))
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_PDF_BYTES = 5 * 1024 * 1024
const ADMIN_UID = '0SYXtQtU61hMim2S9a2aktAeeSA2'
const privateError = (message, status = 400) => Object.assign(new Error(message), { status })
let jwks

function response(res, status, body) {
  res.set('Cache-Control', 'private, no-store')
  res.set('X-Content-Type-Options', 'nosniff')
  return res.status(status).json(body)
}

function configureCors(req, res) {
  const origins = (process.env.CMS_ALLOWED_ORIGINS ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const origin = req.get('origin')
  const localEmulator = process.env.FUNCTIONS_EMULATOR === 'true'
    && /^https?:\/\/(localhost|127\.0\.0\.1|dev\.localhost|admin\.localhost)(:\d+)?$/.test(origin ?? '')
  if (origin && (origins.includes(origin) || localEmulator)) {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Access-Control-Allow-Credentials', 'true')
    res.set('Vary', 'Origin')
  }
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Firebase-Id-Token')
  res.set('Access-Control-Max-Age', '600')
}

async function verifyAccess(req) {
  if (
    process.env.FUNCTIONS_EMULATOR === 'true'
    && process.env.CMS_ALLOW_LOCAL_EMULATOR === 'true'
    && /^https?:\/\/(localhost|127\.0\.0\.1|dev\.localhost|admin\.localhost)(:\d+)?$/.test(req.get('origin') ?? '')
  ) return { sub: 'local-functions-emulator', email: 'local@emulator.invalid' }
  const team = (process.env.CF_ACCESS_TEAM_DOMAIN ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
  const audience = (process.env.CF_ACCESS_AUD ?? '').trim()
  if (!team || !audience) throw privateError('Cloudflare Access verification is not configured on this API.', 503)
  const assertion = req.get('cf-access-jwt-assertion')
    || req.get('Cf-Access-Jwt-Assertion')
    || (req.get('authorization')?.startsWith('Bearer ') ? req.get('authorization').slice(7) : '')
  if (!assertion) throw privateError('Cloudflare Access session required.', 401)
  const issuer = `https://${team}`
  jwks ??= createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  try {
    const { payload } = await jwtVerify(assertion, jwks, { issuer, audience, algorithms: ['RS256'] })
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('Missing subject')
    return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : '' }
  } catch {
    throw privateError('Cloudflare Access token is invalid or expired.', 401)
  }

  async function verifyAdminUser(req) {
    const idToken = req.get('x-firebase-id-token')
    if (!idToken) throw privateError('Firebase administrator sign-in required.', 401)
    let decoded
    try {
      decoded = await adminAuth.verifyIdToken(idToken, true)
    } catch {
      throw privateError('Firebase administrator sign-in is invalid or expired.', 401)
    }
    if (decoded.uid !== ADMIN_UID) throw privateError('This Firebase account is not authorized for the CMS.', 403)
    return {
      sub: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : decoded.uid,
    }
  }
}

const collectionPath = (state, type) => `${state}/${type}/items`
const itemPath = (state, type, id) => `${collectionPath(state, type)}/${id}`
const settingsPath = (state) => `${state}/site/settings/current`
const slugPath = (slug) => `slugRegistry/projects/slugs/${slug}`

function timestamped(value) {
  return JSON.parse(JSON.stringify(value))
}

function publicUrl(storagePath, token, disposition = '') {
  const query = new URLSearchParams({ alt: 'media', token })
  if (disposition) query.set('response-content-disposition', disposition)
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?${query}`
}

function cleanFileName(value) {
  const base = String(value || 'upload').normalize('NFKC').replace(/[\\/\0-\x1f<>:"|?*]/g, '-').replace(/\s+/g, '-').slice(0, 120)
  return base || 'upload'
}

async function assertUniqueProjectSlug(tx, slug, id) {
  const ref = db.doc(slugPath(slug))
  const snapshot = await tx.get(ref)
  if (snapshot.exists && snapshot.data().projectId !== id) throw privateError(`The slug “${slug}” is already in use.`, 409)
  return ref
}

function assertRevision(current, expected, fallbackRevision = 0) {
  if (!Number.isInteger(expected) || expected !== (current?.revision ?? fallbackRevision)) {
    throw privateError('This item changed since you opened it. Reload and try again.', 409)
  }
}

function recordFrom(snapshot) {
  return snapshot.exists ? timestamped({ ...snapshot.data(), id: snapshot.id }) : null
}

async function listRecords(type, state) {
  if (!TYPES.has(type)) throw privateError('Unknown content collection.', 404)
  const query = await db.collection(collectionPath(state, type)).get()
  const rows = await Promise.all(query.docs.map(async (doc) => ({
    ...doc.data(), id: doc.id,
    ...(type === 'media' ? { usedIn: await findMediaUsage(doc.get('storagePath')) } : {}),
  })))
  return rows.map(timestamped)
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
}

async function saveItem(type, id, content, expectedRevision, actor) {
  if (!TYPES.has(type)) throw privateError('Unknown content collection.', 404)
  const validated = parsePayload(type, content)
  const draftRef = db.doc(itemPath('drafts', type, id))
  const publishedRef = db.doc(itemPath('published', type, id))
  const draftResult = await db.runTransaction(async (tx) => {
    const [draftSnap, publishedSnap] = await Promise.all([tx.get(draftRef), tx.get(publishedRef)])
    const current = draftSnap.exists ? draftSnap.data() : null
    assertRevision(current, expectedRevision, publishedSnap.exists ? Number(publishedSnap.get('revision') ?? 0) : 0)
    let slugRef
    const slugDeletions = []
    if (type === 'projects') slugRef = await assertUniqueProjectSlug(tx, validated.slug, id)
    if (type === 'projects' && current?.slug && current.slug !== validated.slug && current.slug !== publishedSnap.get('slug')) {
      const previousDraftSlugRef = db.doc(slugPath(current.slug))
      const previousDraftSlug = await tx.get(previousDraftSlugRef)
      if (previousDraftSlug.exists && previousDraftSlug.get('projectId') === id) slugDeletions.push(previousDraftSlugRef)
    }
    const publishedRevision = publishedSnap.exists ? Number(publishedSnap.get('revision') ?? 0) : 0
    const revision = Math.max(Number(current?.revision ?? 0), publishedRevision) + 1
    const next = {
      ...validated, id, status: 'draft', revision,
      publishedRevision: Number(current?.publishedRevision ?? publishedRevision),
      basePublishedRevision: publishedRevision,
      createdAt: current?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.sub,
    }
    tx.set(draftRef, next)
    if (slugRef) tx.set(slugRef, { projectId: id, slug: validated.slug })
    for (const reference of slugDeletions) tx.delete(reference)
    return { id, revision, status: 'draft', publishedRevision: Number(next.publishedRevision) }
  })
  return timestamped(draftResult)
}

async function createItem(type, content, actor) {
  if (!TYPES.has(type)) throw privateError('Unknown content collection.', 404)
  const id = db.collection(collectionPath('drafts', type)).doc().id
  return saveItem(type, id, content, 0, actor)
}

async function reorderItems(type, items, actor) {
  if (!TYPES.has(type)) throw privateError('Unknown content collection.', 404)
  if (!Array.isArray(items) || !items.length || items.length > 200) throw privateError('Provide between 1 and 200 ordered items.')
  const ids = new Set()
  for (const item of items) {
    if (!item?.id || ids.has(item.id) || !Number.isInteger(item.order) || item.order < 0) throw privateError('Each ordered item needs a unique id and non-negative order.')
    ids.add(item.id)
  }
  return db.runTransaction(async (tx) => {
    const refs = items.map((item) => ({
      item,
      draftRef: db.doc(itemPath('drafts', type, item.id)),
      publishedRef: db.doc(itemPath('published', type, item.id)),
    }))
    const snapshots = await Promise.all(refs.map(async ({ draftRef, publishedRef }) => Promise.all([tx.get(draftRef), tx.get(publishedRef)])))
    const changes = refs.map(({ item, draftRef, publishedRef }, index) => {
      const [draftSnap, publishedSnap] = snapshots[index]
      if (!draftSnap.exists && !publishedSnap.exists) throw privateError(`Item ${item.id} was not found.`, 404)
      const current = draftSnap.exists ? draftSnap.data() : publishedSnap.data()
      const currentRevision = Number(current.revision ?? 0)
      if (item.expectedRevision !== currentRevision) throw privateError(`Item ${item.id} changed. Reload before reordering.`, 409)
      const publishedRevision = publishedSnap.exists ? Number(publishedSnap.get('revision') ?? 0) : 0
      const content = Object.fromEntries(Object.entries(current).filter(([key]) => !['id', 'status', 'revision', 'publishedRevision', 'basePublishedRevision', 'createdAt', 'updatedAt', 'updatedBy', 'publishedAt', 'publishedBy'].includes(key)))
      const revision = Math.max(currentRevision, publishedRevision) + 1
      return { draftRef, source: current, data: { ...content, status: 'draft', revision, publishedRevision: Number(current.publishedRevision ?? publishedRevision), basePublishedRevision: publishedRevision, order: item.order, createdAt: current.createdAt ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.sub } }
    })
    for (const change of changes) tx.set(change.draftRef, change.data)
    return changes.map(({ data }, index) => ({ id: items[index].id, revision: data.revision, status: 'draft', order: data.order }))
  })
}

async function publishItem(type, id, expectedRevision, actor) {
  if (!TYPES.has(type)) throw privateError('Unknown content collection.', 404)
  const draftRef = db.doc(itemPath('drafts', type, id))
  const publishedRef = db.doc(itemPath('published', type, id))
  const result = await db.runTransaction(async (tx) => {
    const [draftSnap, publishedSnap, siteSnap] = await Promise.all([
      tx.get(draftRef), tx.get(publishedRef), tx.get(db.doc(settingsPath('published'))),
    ])
    const activeResumeSnap = type === 'resumes'
      ? await tx.get(db.collection(collectionPath('published', 'resumes')).where('isActive', '==', true))
      : null
    if (!draftSnap.exists) throw privateError('Draft was not found.', 404)
    const draft = draftSnap.data()
    assertRevision(draft, expectedRevision)
    const currentPublishedRevision = publishedSnap.exists ? Number(publishedSnap.get('revision') ?? 0) : 0
    if (Number(draft.basePublishedRevision ?? 0) !== currentPublishedRevision) throw privateError('The published version changed after this draft was started. Reload before publishing.', 409)
    const validated = parsePayload(type, Object.fromEntries(Object.entries(draft).filter(([key]) => !['id', 'status', 'revision', 'publishedRevision', 'basePublishedRevision', 'createdAt', 'updatedAt', 'updatedBy', 'publishedAt', 'publishedBy'].includes(key))))
    let slugRef
    if (type === 'projects') slugRef = await assertUniqueProjectSlug(tx, validated.slug, id)
    const slugDeletions = []
    if (type === 'projects' && publishedSnap.exists && publishedSnap.get('slug') !== validated.slug) {
      const oldSlugRef = db.doc(slugPath(publishedSnap.get('slug')))
      const oldSlugSnap = await tx.get(oldSlugRef)
      if (oldSlugSnap.exists && oldSlugSnap.get('projectId') === id) slugDeletions.push(oldSlugRef)
    }
    const siteVersion = Number(siteSnap.get('siteVersion') ?? 0) + 1
    const publishedAt = FieldValue.serverTimestamp()
    const publication = {
      ...validated, id, status: 'published', revision: Number(draft.revision ?? 1),
      publishedRevision: Number(draft.revision ?? 1), publishedAt,
      publishedBy: actor.email || actor.sub, updatedAt: FieldValue.serverTimestamp(),
      ...(type === 'resumes' ? { isActive: true } : {}),
    }
    if (slugRef) tx.set(slugRef, { projectId: id, slug: validated.slug })
    for (const oldSlugRef of slugDeletions) tx.delete(oldSlugRef)
    for (const prior of activeResumeSnap?.docs ?? []) {
      if (prior.id !== id) tx.update(prior.ref, { isActive: false, updatedAt: FieldValue.serverTimestamp() })
    }
    tx.set(publishedRef, publication)
    tx.set(draftRef, { ...draft, status: 'published', publishedRevision: publication.revision, basePublishedRevision: publication.revision, publishedAt, updatedAt: FieldValue.serverTimestamp() })
    tx.set(db.doc(settingsPath('published')), {
      ...(siteSnap.exists ? siteSnap.data() : {}), status: siteSnap.get('status') ?? 'published', visibility: true,
      siteVersion, lastPublishedAt: publishedAt, updatedAt: FieldValue.serverTimestamp(),
      ...(type === 'resumes' ? { resumeManaged: true } : {}),
    }, { merge: true })
    return { id, type, revision: publication.revision, siteVersion }
  })
  return result
}

async function unpublishItem(type, id) {
  if (!TYPES.has(type)) throw privateError('Unknown content collection.', 404)
  const draftRef = db.doc(itemPath('drafts', type, id))
  const publishedRef = db.doc(itemPath('published', type, id))
  await db.runTransaction(async (tx) => {
    const [draft, published, site] = await Promise.all([tx.get(draftRef), tx.get(publishedRef), tx.get(db.doc(settingsPath('published')))])
    if (!draft.exists && !published.exists) throw privateError('Content item was not found.', 404)
    if (published.exists) tx.update(publishedRef, { status: 'unpublished', visibility: false, isActive: false, updatedAt: FieldValue.serverTimestamp() })
    if (draft.exists) tx.update(draftRef, { status: 'unpublished', visibility: false, updatedAt: FieldValue.serverTimestamp() })
    tx.set(db.doc(settingsPath('published')), { ...(site.exists ? site.data() : {}), siteVersion: Number(site.get('siteVersion') ?? 0) + 1, lastPublishedAt: FieldValue.serverTimestamp(), ...(type === 'resumes' ? { resumeManaged: true } : {}) }, { merge: true })
  })
  return { id, status: 'unpublished' }
}

async function deleteItem(type, id) {
  if (!TYPES.has(type)) throw privateError('Unknown content collection.', 404)
  const draftRef = db.doc(itemPath('drafts', type, id))
  const publishedRef = db.doc(itemPath('published', type, id))
  const result = await db.runTransaction(async (tx) => {
    const [draftSnap, publishedSnap, siteSnap] = await Promise.all([
      tx.get(draftRef), tx.get(publishedRef), tx.get(db.doc(settingsPath('published'))),
    ])
    if (!draftSnap.exists && !publishedSnap.exists) throw privateError('Content item was not found.', 404)
    const now = FieldValue.serverTimestamp()
    const archive = (data) => ({ ...data, id, status: 'deleted', visibility: false, isActive: false, deletedAt: now, updatedAt: now })
    const draftData = draftSnap.exists ? draftSnap.data() : publishedSnap.data()
    const publishedData = publishedSnap.exists ? publishedSnap.data() : draftSnap.data()
    const slugRefs = type === 'projects'
      ? [...new Set([draftData.slug, publishedData.slug].filter(Boolean))].map((slug) => db.doc(slugPath(slug)))
      : []
    const slugSnaps = await Promise.all(slugRefs.map((ref) => tx.get(ref)))
    tx.set(draftRef, archive(draftData))
    tx.set(publishedRef, archive(publishedData))
    slugSnaps.forEach((slugSnap, index) => { if (slugSnap.exists && slugSnap.get('projectId') === id) tx.delete(slugRefs[index]) })
    tx.set(db.doc(settingsPath('published')), {
      ...(siteSnap.exists ? siteSnap.data() : {}), siteVersion: Number(siteSnap.get('siteVersion') ?? 0) + 1,
      lastPublishedAt: now, ...(type === 'resumes' ? { resumeManaged: true } : {}),
    }, { merge: true })
    return { id, status: 'deleted' }
  })
  return result
}

async function saveSettings(content, expectedRevision, actor) {
  const value = settingsSchema.parse(content)
  const draftRef = db.doc(settingsPath('drafts'))
  const publishedRef = db.doc(settingsPath('published'))
  return db.runTransaction(async (tx) => {
    const [draftSnap, publishedSnap] = await Promise.all([tx.get(draftRef), tx.get(publishedRef)])
    const current = draftSnap.exists ? draftSnap.data() : null
    assertRevision(current, expectedRevision, publishedSnap.exists ? Number(publishedSnap.get('revision') ?? 0) : 0)
    const publishedRevision = Number(publishedSnap.get('revision') ?? 0)
    const revision = Math.max(Number(current?.revision ?? 0), publishedRevision) + 1
    const next = { ...value, status: 'draft', revision, publishedRevision: Number(current?.publishedRevision ?? publishedRevision), basePublishedRevision: publishedRevision, createdAt: current?.createdAt ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.sub }
    tx.set(draftRef, next)
    return { id: 'settings', revision, status: 'draft', publishedRevision: Number(next.publishedRevision) }
  })
}

async function publishSettings(expectedRevision, actor) {
  const draftRef = db.doc(settingsPath('drafts'))
  const publishedRef = db.doc(settingsPath('published'))
  return db.runTransaction(async (tx) => {
    const [draftSnap, publishedSnap] = await Promise.all([tx.get(draftRef), tx.get(publishedRef)])
    if (!draftSnap.exists) throw privateError('Settings draft was not found.', 404)
    const draft = draftSnap.data()
    assertRevision(draft, expectedRevision)
    const previousRevision = Number(publishedSnap.get('revision') ?? 0)
    if (Number(draft.basePublishedRevision ?? 0) !== previousRevision) throw privateError('Published settings changed. Reload before publishing.', 409)
    const data = settingsSchema.parse(Object.fromEntries(Object.entries(draft).filter(([key]) => !['status', 'revision', 'publishedRevision', 'basePublishedRevision', 'createdAt', 'updatedAt', 'updatedBy', 'publishedAt', 'publishedBy'].includes(key))))
    const revision = Number(draft.revision ?? 1)
    const siteVersion = Number(publishedSnap.get('siteVersion') ?? 0) + 1
    tx.set(publishedRef, { ...data, status: 'published', visibility: true, revision, publishedRevision: revision, basePublishedRevision: revision, siteVersion, resumeManaged: publishedSnap.get('resumeManaged') === true, publishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), publishedBy: actor.email || actor.sub })
    tx.set(draftRef, { ...draft, status: 'published', publishedRevision: revision, basePublishedRevision: revision, updatedAt: FieldValue.serverTimestamp() })
    return { siteVersion, revision }
  })
}

function isPublicAddress(address) {
  try { return ipaddr.parse(address).range() === 'unicast' } catch { return false }
}

async function safeDispatcher(hostname) {
  let records
  try {
    const normalizedHost = hostname.replace(/^\[|\]$/g, '')
    records = ipaddr.isValid(normalizedHost) ? [{ address: normalizedHost, family: ipaddr.parse(normalizedHost).kind() === 'ipv6' ? 6 : 4 }] : await lookup(normalizedHost, { all: true, verbatim: true })
  } catch { throw privateError('The image host could not be resolved.', 422) }
  if (!records.length || records.some((record) => !isPublicAddress(record.address))) throw privateError('Image imports cannot target private or internal network addresses.', 422)
  const approved = records
  return new Agent({ connect: { lookup: (_host, options, callback) => {
    const matches = approved.filter((entry) => !options?.family || entry.family === options.family)
    const selected = matches[0] ?? approved[0]
    if (options?.all) callback(null, approved)
    else callback(null, selected.address, selected.family)
  } } })
}

function validateRemoteUrl(value, previousProtocol = '') {
  let url
  try { url = new URL(value) } catch { throw privateError('Enter a valid image URL.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw privateError('Only public HTTP or HTTPS image URLs are allowed.')
  if (previousProtocol === 'https:' && url.protocol !== 'https:') throw privateError('Secure image imports cannot redirect to HTTP.')
  return url
}

async function fetchPublicImage(source) {
  let target = validateRemoteUrl(source)
  for (let hop = 0; hop <= 4; hop += 1) {
    const dispatcher = await safeDispatcher(target.hostname)
    let fetched
    try {
      fetched = await fetch(target, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(12000), dispatcher, headers: { accept: 'image/jpeg,image/png,image/webp' } })
    } catch (error) {
      await dispatcher.close()
      if (error?.status) throw error
      throw privateError('Could not fetch this image URL.', 422)
    }
    await dispatcher.close()
    if ([301, 302, 303, 307, 308].includes(fetched.status)) {
      if (hop === 4) throw privateError('Image URL redirected too many times.', 422)
      const location = fetched.headers.get('location')
      if (!location) throw privateError('Image redirect did not include a destination.', 422)
      target = validateRemoteUrl(new URL(location, target).href, target.protocol)
      continue
    }
    if (!fetched.ok) throw privateError(`Image server returned HTTP ${fetched.status}.`, 422)
    const contentType = (fetched.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw privateError('Only JPEG, PNG, or WebP images can be imported.', 422)
    const declaredLength = Number(fetched.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_IMAGE_BYTES) throw privateError('Image exceeds the 12 MB limit.', 413)
    const reader = fetched.body?.getReader()
    if (!reader) throw privateError('Image response was empty.', 422)
    const chunks = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw privateError('Image exceeds the 12 MB limit.', 413) }
      chunks.push(Buffer.from(value))
    }
    return { bytes: Buffer.concat(chunks), contentType, sourceUrl: source }
  }
  throw privateError('Image import failed.', 422)
}

function detectImage(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return ''
}

async function inspectImage(bytes, contentType) {
  const detected = detectImage(bytes)
  if (!detected || detected !== contentType) throw privateError('The file content does not match a supported image type.', 422)
  let metadata
  try { metadata = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata() } catch { throw privateError('The image data is invalid or exceeds safe decoding limits.', 422) }
  if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp'].includes(metadata.format)) throw privateError('Unsupported or unreadable image.', 422)
  return { detected, metadata }
}

async function storeImage({ bytes, contentType, fileName, sourceUrl = '', alt = '' }) {
  const { detected, metadata } = await inspectImage(bytes, contentType)
  const id = randomUUID()
  const name = cleanFileName(fileName || `image.${metadata.format}`)
  const storagePath = `media/${id}/${name}`
  const token = randomUUID()
  await bucket.file(storagePath).save(bytes, {
    resumable: false,
    metadata: { contentType: detected, metadata: { firebaseStorageDownloadTokens: token, cmsManaged: 'true' } },
  })
  const record = {
    url: publicUrl(storagePath, token), storagePath, type: 'image', sizeBytes: bytes.length,
    usedIn: [], visibility: true, order: Date.now(), fileName: name, mimeType: detected,
    width: metadata.width, height: metadata.height, sourceUrl, alt,
  }
  const validated = parsePayload('media', record)
  const now = FieldValue.serverTimestamp()
  await db.doc(itemPath('drafts', 'media', id)).set({ ...validated, id, status: 'published', revision: 1, publishedRevision: 1, basePublishedRevision: 1, createdAt: now, updatedAt: now })
  await db.doc(itemPath('published', 'media', id)).set({ ...validated, id, status: 'published', revision: 1, publishedRevision: 1, createdAt: now, updatedAt: now, publishedAt: now })
  return { ...record, id, status: 'published', revision: 1 }
}

async function replaceManagedImage(id, { bytes, contentType, fileName, alt = '' }) {
  const { detected, metadata } = await inspectImage(bytes, contentType)
  const publishedRef = db.doc(itemPath('published', 'media', id))
  const draftRef = db.doc(itemPath('drafts', 'media', id))
  const currentSnap = await publishedRef.get()
  if (!currentSnap.exists || currentSnap.get('status') !== 'published' || currentSnap.get('type') !== 'image') throw privateError('The managed image to replace was not found.', 404)
  const current = currentSnap.data()
  let token
  try { token = new URL(current.url).searchParams.get('token') } catch { token = '' }
  if (!token || !current.storagePath?.startsWith('media/')) throw privateError('This image does not have a replaceable managed asset URL.', 409)

  await bucket.file(current.storagePath).save(bytes, {
    resumable: false,
    metadata: { contentType: detected, metadata: { firebaseStorageDownloadTokens: token, cmsManaged: 'true' } },
  })
  const validated = parsePayload('media', {
    ...current, url: current.url, storagePath: current.storagePath, type: 'image',
    sizeBytes: bytes.length, fileName: cleanFileName(fileName), mimeType: detected,
    width: metadata.width, height: metadata.height, sourceUrl: '', alt: String(alt || current.alt || '').slice(0, 300),
  })
  const result = await db.runTransaction(async (tx) => {
    const [publishedSnap, draftSnap] = await Promise.all([tx.get(publishedRef), tx.get(draftRef)])
    if (!publishedSnap.exists || publishedSnap.get('storagePath') !== current.storagePath) throw privateError('The managed image changed while it was being replaced.', 409)
    const existingDraft = draftSnap.exists ? draftSnap.data() : {}
    const revision = Number(publishedSnap.get('revision') ?? 0) + 1
    const updatedAt = FieldValue.serverTimestamp()
    const publication = { ...validated, id, status: 'published', revision, publishedRevision: revision, updatedAt }
    tx.set(publishedRef, { ...publication, publishedAt: publishedSnap.get('publishedAt') ?? updatedAt })
    tx.set(draftRef, {
      ...existingDraft, ...publication,
      basePublishedRevision: revision, createdAt: existingDraft.createdAt ?? publishedSnap.get('createdAt') ?? updatedAt,
    })
    return { ...validated, id, status: 'published', revision }
  })
  return result
}

async function uploadUrl(body, actor) {
  const kind = body.kind === 'resume' ? 'resume' : 'image'
  const maxBytes = kind === 'resume' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
  const allowed = kind === 'resume' ? ['application/pdf'] : ['image/jpeg', 'image/png', 'image/webp']
  if (!allowed.includes(body.contentType)) throw privateError('Unsupported file type.')
  const id = randomUUID()
  const safeName = cleanFileName(body.fileName)
  const subject = createHash('sha256').update(actor.sub).digest('hex').slice(0, 24)
  const storagePath = `cms-incoming/${subject}/${id}/${safeName}`
  const token = randomUUID()
  const file = bucket.file(storagePath)
  const [url] = await file.getSignedUrl({
    version: 'v4', action: 'write', expires: Date.now() + 10 * 60 * 1000,
    contentType: body.contentType,
    extensionHeaders: { 'x-goog-meta-cms-subject': subject, 'x-goog-meta-cms-upload': id, 'x-goog-meta-firebaseStorageDownloadTokens': token },
  })
  return {
    url, storagePath, uploadId: id, maxBytes, expiresInSeconds: 600, kind,
    requiredHeaders: {
      'Content-Type': body.contentType,
      'x-goog-meta-cms-subject': subject,
      'x-goog-meta-cms-upload': id,
      'x-goog-meta-firebaseStorageDownloadTokens': token,
    },
  }
}

async function finalizeUpload(body, actor) {
  const match = /^cms-incoming\/([a-f0-9]{24})\/([a-f0-9-]{36})\/([^/]+)$/.exec(String(body.storagePath ?? ''))
  if (!match) throw privateError('Upload path is invalid.')
  const subject = createHash('sha256').update(actor.sub).digest('hex').slice(0, 24)
  if (match[1] !== subject) throw privateError('This upload belongs to a different Access session.', 403)
  const kind = body.kind === 'resume' ? 'resume' : 'image'
  const source = bucket.file(body.storagePath)
  const [metadata] = await source.getMetadata().catch(() => { throw privateError('Uploaded file is missing or expired.', 404) })
  const maxBytes = kind === 'resume' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
  const size = Number(metadata.size ?? 0)
  const expectedType = kind === 'resume' ? 'application/pdf' : String(metadata.contentType ?? '')
  if (!size || size > maxBytes) { await source.delete().catch(() => {}); throw privateError(`Upload exceeds the ${kind === 'resume' ? '5 MB' : '12 MB'} size limit.`, 413) }
  if (kind === 'resume' && expectedType !== 'application/pdf') { await source.delete().catch(() => {}); throw privateError('Resume must be a PDF.', 422) }
  if (kind === 'image' && !['image/jpeg', 'image/png', 'image/webp'].includes(expectedType)) { await source.delete().catch(() => {}); throw privateError('Only JPEG, PNG, or WebP images are accepted.', 422) }
  const [bytes] = await source.download()
  const custom = metadata.metadata ?? {}
  if (custom['cms-subject'] !== subject || custom['cms-upload'] !== match[2]) { await source.delete().catch(() => {}); throw privateError('Upload metadata is invalid.', 403) }
  await source.delete()
  if (kind === 'resume') {
    if (!isValidPdfDocument(bytes)) throw privateError('This file is not a structurally valid PDF document.', 422)
    const path = `resumes/${randomUUID()}/${cleanFileName(match[3])}`
    const token = custom.firebaseStorageDownloadTokens || randomUUID()
    await bucket.file(path).save(bytes, { resumable: false, metadata: { contentType: 'application/pdf', contentDisposition: 'attachment; filename="Fitsum-Mesfin-Resume.pdf"', metadata: { firebaseStorageDownloadTokens: token, cmsManaged: 'true' } } })
    const id = db.collection(collectionPath('drafts', 'resumes')).doc().id
    const resumes = await db.collection(collectionPath('published', 'resumes')).get()
    const version = `${Math.max(0, ...resumes.docs.map((doc) => Number.parseFloat(doc.get('version')) || 0)) + 1}.0`
    const record = { fileUrl: publicUrl(path, token, 'attachment; filename="Fitsum-Mesfin-Resume.pdf"'), previewUrl: publicUrl(path, token, 'inline'), storagePath: path, fileName: cleanFileName(match[3]), sizeKB: Math.ceil(size / 1024), version, notes: '', isActive: false, visibility: true, order: Date.now() }
    const validated = parsePayload('resumes', record)
    const now = FieldValue.serverTimestamp()
    await db.doc(itemPath('drafts', 'resumes', id)).set({ ...validated, id, status: 'draft', revision: 1, publishedRevision: 0, basePublishedRevision: 0, createdAt: now, updatedAt: now })
    return { ...record, id, status: 'draft', revision: 1 }
  }
  if (body.replaceMediaId) return replaceManagedImage(String(body.replaceMediaId), { bytes, contentType: expectedType, fileName: match[3], alt: String(body.alt ?? '').slice(0, 300) })
  return storeImage({ bytes, contentType: expectedType, fileName: match[3], alt: String(body.alt ?? '').slice(0, 300) })
}

async function findMediaUsage(storagePath) {
  if (!storagePath) return []
  const usedIn = []
  for (const state of ['drafts', 'published']) {
    for (const type of ['projects', 'experiences', 'education', 'resumes']) {
      const snap = await db.collection(collectionPath(state, type)).get()
      for (const item of snap.docs) {
        if (JSON.stringify(item.data()).includes(storagePath)) usedIn.push(`${type}/${item.id}`)
      }
    }
  }
  const settings = await Promise.all(['drafts', 'published'].map((state) => db.doc(settingsPath(state)).get()))
  if (settings.some((item) => item.exists && JSON.stringify(item.data()).includes(storagePath))) usedIn.push('site/settings')
  return [...new Set(usedIn)]
}

async function deleteMedia(id) {
  const [draft, published] = await Promise.all([
    db.doc(itemPath('drafts', 'media', id)).get(), db.doc(itemPath('published', 'media', id)).get(),
  ])
  if (!draft.exists && !published.exists) throw privateError('Media item was not found.', 404)
  const storagePath = draft.get('storagePath') || published.get('storagePath')
  const usedIn = await findMediaUsage(storagePath)
  if (usedIn.length) throw privateError(`This asset is used by ${usedIn.join(', ')}. Replace those references before deleting it.`, 409)
  await bucket.file(storagePath).delete({ ignoreNotFound: true })
  const now = FieldValue.serverTimestamp()
  await db.doc(itemPath('drafts', 'media', id)).set({ ...(draft.exists ? draft.data() : published.data()), status: 'deleted', visibility: false, deletedAt: now, updatedAt: now }, { merge: true })
  await db.doc(itemPath('published', 'media', id)).set({ ...(published.exists ? published.data() : draft.data()), status: 'deleted', visibility: false, deletedAt: now, updatedAt: now }, { merge: true })
  return { id, deleted: true }
}

async function handle(req, actor) {
  const pathname = new URL(req.url, 'https://cms.invalid').pathname.replace(/\/+$/, '') || '/'
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'api') throw privateError('Not found.', 404)
  const body = req.body && typeof req.body === 'object' ? req.body : {}

  if (segments[1] === 'health' && req.method === 'GET') {
    return { ok: true, access: 'verified', administrator: 'verified', projectId: process.env.GCLOUD_PROJECT ?? '' }
  }
  if (segments[1] === 'settings') {
    const ref = db.doc(settingsPath(req.query.view === 'published' ? 'published' : 'drafts'))
    if (req.method === 'GET') return recordFrom(await ref.get())
    if (req.method === 'PUT') return saveSettings(body.content, body.expectedRevision, actor)
    if (req.method === 'POST' && segments[2] === 'publish') return publishSettings(body.expectedRevision, actor)
  }
  if (segments[1] === 'media' && segments[2] === 'upload-url' && req.method === 'POST') return uploadUrl(body, actor)
  if (segments[1] === 'media' && segments[2] === 'finalize' && req.method === 'POST') return finalizeUpload(body, actor)
  if (segments[1] === 'media' && segments[2] === 'import' && req.method === 'POST') {
    const target = validateRemoteUrl(body.sourceUrl)
    const remote = await fetchPublicImage(target.href)
    return storeImage({ ...remote, fileName: body.fileName || target.pathname.split('/').pop() || 'imported-image', alt: String(body.alt ?? '').slice(0, 300) })
  }
  if (segments.length === 2 && TYPES.has(segments[1])) {
    const type = segments[1]
    if (req.method === 'GET') return listRecords(type, req.query.view === 'published' ? 'published' : 'drafts')
    if (req.method === 'POST') return createItem(type, body.content, actor)
  }
  if (segments.length === 3 && TYPES.has(segments[1]) && segments[2] === 'reorder' && req.method === 'PATCH') return reorderItems(segments[1], body.items, actor)
  if (segments[1] === 'media' && segments[2] && req.method === 'DELETE') return deleteMedia(segments[2])
  if (segments.length === 3 && TYPES.has(segments[1])) {
    const [, type, id] = segments
    if (req.method === 'GET') return recordFrom(await db.doc(itemPath(req.query.view === 'published' ? 'published' : 'drafts', type, id)).get())
    if (req.method === 'PUT') return saveItem(type, id, body.content, body.expectedRevision, actor)
    if (req.method === 'POST' && segments[3] === 'publish') return publishItem(type, id, body.expectedRevision, actor)
    if (req.method === 'POST' && segments[3] === 'unpublish') return unpublishItem(type, id)
    if (req.method === 'DELETE') return deleteItem(type, id)
  }
  if (segments.length === 4 && TYPES.has(segments[1])) {
    const [, type, id, action] = segments
    if (action === 'publish' && req.method === 'POST') return publishItem(type, id, body.expectedRevision, actor)
    if (action === 'unpublish' && req.method === 'POST') return unpublishItem(type, id)
  }
  throw privateError('Not found.', 404)
}

export const cmsApi = onRequest({
  region: process.env.CMS_FUNCTION_REGION || 'us-central1',
  cors: false,
  timeoutSeconds: 60,
  memory: '1GiB',
  maxInstances: 10,
}, async (req, res) => {
  configureCors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return response(res, 405, { error: 'Method not allowed.' })
  try {
    await verifyAccess(req)
    const actor = await verifyAdminUser(req)
    const result = await handle(req, actor)
    return response(res, 200, { data: result })
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : error?.name === 'ZodError' ? 422 : 500
    const message = error?.name === 'ZodError'
      ? error.issues.map((issue) => `${issue.path.join('.') || 'content'}: ${issue.message}`).join(' ')
      : status >= 500 ? 'The CMS API could not complete this request.' : error.message
    if (status >= 500) console.error('CMS API error', error)
    return response(res, status, { error: message })
  }
})
