import { contentSchemas, siteSettingsSchema, resumeSchema } from '../../src/lib/db/contentSchemas.js'
import { isValidPdfDocument } from '../../src/lib/db/pdfValidation.js'

const CONTENT_TYPES = new Set(['projects', 'experiences', 'education', 'resumes'])
const MAX_JSON_BYTES = 256 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_PDF_BYTES = 5 * 1024 * 1024
const SIGNED_MEDIA_TTL = 15 * 60
const GOOGLE_KEYS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
let cachedGoogleKeys
let cachedGoogleKeysUntil = 0

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function json(data, status = 200, cache = false) {
  return Response.json(status >= 400 ? { error: data } : { data }, {
    status,
    headers: {
      'cache-control': cache && status < 400 ? 'public, max-age=0, s-maxage=15, stale-while-revalidate=30' : 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function configReady(env) {
  return Boolean(
    env.DB && env.MEDIA && env.FIREBASE_PROJECT_ID &&
    env.FIREBASE_WEB_API_KEY && env.CMS_ADMIN_UIDS?.trim() &&
    env.MEDIA_SIGNING_SECRET?.length >= 32,
  )
}

function requireConfig(env) {
  if (!configReady(env)) {
    throw new ApiError(503, 'Portfolio services are not configured. Add the D1 database, R2 bucket, Firebase project ID and web API key, administrator UID allowlist, and media signing secret to Cloudflare Pages.')
  }
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

function parseJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)))
}

async function googleKeys(forceRefresh = false) {
  if (!forceRefresh && cachedGoogleKeys && Date.now() < cachedGoogleKeysUntil) return cachedGoogleKeys
  let response
  try {
    response = await fetch(GOOGLE_KEYS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } })
  } catch {
    throw new ApiError(503, 'Firebase token verification is temporarily unavailable.')
  }
  if (!response.ok) throw new ApiError(503, 'Firebase token verification is temporarily unavailable.')
  const keys = await response.json().catch(() => null)
  if (!Array.isArray(keys.keys)) throw new ApiError(503, 'Firebase token verification returned an invalid key set.')
  cachedGoogleKeys = keys.keys
  cachedGoogleKeysUntil = Date.now() + 60 * 60 * 1000
  return cachedGoogleKeys
}

async function verifyAdmin(request, env) {
  const token = request.headers.get('x-firebase-id-token')
  if (!token) throw new ApiError(401, 'Firebase administrator sign-in required.')
  const pieces = token.split('.')
  if (pieces.length !== 3) throw new ApiError(401, 'The administrator sign-in token is invalid or expired.')

  let header
  let claims
  try {
    header = parseJwtPart(pieces[0])
    claims = parseJwtPart(pieces[1])
  } catch {
    throw new ApiError(401, 'The administrator sign-in token is invalid or expired.')
  }
  if (
    !header || typeof header !== 'object' || Array.isArray(header) ||
    !claims || typeof claims !== 'object' || Array.isArray(claims) ||
    header.alg !== 'RS256' || typeof header.kid !== 'string'
  ) {
    throw new ApiError(401, 'The administrator sign-in token is invalid or expired.')
  }
  let key = (await googleKeys()).find((candidate) => candidate.kid === header.kid)
  if (!key) key = (await googleKeys(true)).find((candidate) => candidate.kid === header.kid)
  if (!key) throw new ApiError(401, 'The administrator sign-in token is invalid or expired.')

  let validSignature = false
  try {
    const publicKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    validSignature = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      decodeBase64Url(pieces[2]),
      new TextEncoder().encode(`${pieces[0]}.${pieces[1]}`),
    )
  } catch {
    throw new ApiError(401, 'The administrator sign-in token is invalid or expired.')
  }

  const now = Math.floor(Date.now() / 1000)
  const projectId = env.FIREBASE_PROJECT_ID.trim()
  const allowlist = new Set(env.CMS_ADMIN_UIDS.split(',').map((uid) => uid.trim()).filter(Boolean))
  if (
    !validSignature || claims.iss !== `https://securetoken.google.com/${projectId}` ||
    claims.aud !== projectId || typeof claims.sub !== 'string' || !claims.sub ||
    claims.sub.length > 128 || !Number.isFinite(claims.exp) || claims.exp <= now ||
    !Number.isFinite(claims.iat) || claims.iat > now + 60 ||
    !Number.isFinite(claims.auth_time) || claims.auth_time > now + 60 ||
    !allowlist.has(claims.sub)
  ) {
    throw new ApiError(401, 'This account is not authorized to manage portfolio content. Sign in with an administrator account.')
  }
  let accountResponse
  try {
    accountResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    })
  } catch {
    throw new ApiError(503, 'Firebase could not verify the administrator account. Retry the request.')
  }
  if (!accountResponse.ok) {
    const accountError = await accountResponse.json().catch(() => null)
    if (accountError?.error?.message === 'API_KEY_INVALID') {
      throw new ApiError(503, 'Firebase account verification is misconfigured. Check FIREBASE_WEB_API_KEY in Cloudflare Pages.')
    }
    throw new ApiError(accountResponse.status >= 500 ? 503 : 401, 'The administrator sign-in token is invalid, expired, or revoked.')
  }
  const accountPayload = await accountResponse.json().catch(() => null)
  const account = accountPayload?.users?.find((user) => user.localId === claims.sub)
  const validSince = Number(account?.validSince || 0)
  if (!account || account.disabled === true || (validSince > 0 && claims.auth_time < validSince)) {
    throw new ApiError(401, 'This administrator account is disabled or its sign-in has been revoked. Sign in again or contact the site owner.')
  }
  return { uid: claims.sub }
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0)
  if (length > MAX_JSON_BYTES) throw new ApiError(413, 'The request is too large.')
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) throw new ApiError(413, 'The request is too large.')
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON.')
  }
}

function recordFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    revision: row.revision,
    publishedRevision: row.published_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    authorId: row.author_id,
    publishedBy: row.published_by,
    draftData: row.draft_data ? JSON.parse(row.draft_data) : null,
    publishedData: row.published_data ? JSON.parse(row.published_data) : null,
  }
}

function assertType(type) {
  if (!CONTENT_TYPES.has(type)) throw new ApiError(404, 'Unknown content type.')
}

function validateContent(type, content) {
  const schema = type === 'settings' ? siteSettingsSchema : contentSchemas[type]
  if (!schema) throw new ApiError(404, 'Unknown content type.')
  const parsed = schema.safeParse(content)
  if (!parsed.success) {
    throw new ApiError(422, parsed.error.issues.map((issue) => `${issue.path.join('.') || 'content'}: ${issue.message}`).join(' '))
  }
  return parsed.data
}

function prepareStoredData(value) {
  if (Array.isArray(value)) return value.map(prepareStoredData)
  if (!value || typeof value !== 'object') return value
  const next = { ...value }
  if (next.mediaProvider === 'cloudflare-r2') {
    next.url = ''
    next.fileUrl = ''
    next.previewUrl = ''
  }
  for (const key of Object.keys(next)) next[key] = prepareStoredData(next[key])
  return next
}

function mediaKeys(value, keys = new Set()) {
  if (Array.isArray(value)) value.forEach((entry) => mediaKeys(entry, keys))
  else if (value && typeof value === 'object') {
    if (value.mediaProvider === 'cloudflare-r2' && typeof value.storagePath === 'string') keys.add(value.storagePath)
    Object.values(value).forEach((entry) => mediaKeys(entry, keys))
  }
  return keys
}

async function signMediaUrl(key, env) {
  const expires = Math.floor(Date.now() / 1000) + SIGNED_MEDIA_TTL
  const signingKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.MEDIA_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(`${key}:${expires}`)))
  const sig = Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `/api/media?key=${encodeURIComponent(key)}&expires=${expires}&sig=${sig}`
}

async function hydrateMedia(value, env) {
  if (Array.isArray(value)) return Promise.all(value.map((entry) => hydrateMedia(entry, env)))
  if (!value || typeof value !== 'object') return value
  const next = { ...value }
  if (next.mediaProvider === 'cloudflare-r2' && next.storagePath) {
    const url = await signMediaUrl(next.storagePath, env)
    if ('fileName' in next) {
      next.fileUrl = url
      next.previewUrl = url
    } else next.url = url
  }
  for (const key of Object.keys(next)) {
    if (!['url', 'fileUrl', 'previewUrl', 'storagePath'].includes(key)) next[key] = await hydrateMedia(next[key], env)
  }
  return next
}

async function adminRecord(record, env) {
  if (!record) return null
  return {
    ...record,
    draftData: await hydrateMedia(record.draftData, env),
    publishedData: await hydrateMedia(record.publishedData, env),
  }
}

async function publicRecord(type, record, env) {
  if (!record?.publishedData) return null
  const content = await hydrateMedia(record.publishedData, env)
  if (type === 'resumes') {
    if (!content.isActive || !content.visibility) return null
    return { ...content, id: record.id, status: 'published', fileUrl: content.fileUrl, previewUrl: content.previewUrl, storagePath: '', mediaProvider: '' }
  }
  if (content.visibility === false) return null
  return { ...content, id: record.id, status: 'published', visibility: true }
}

function checkRevision(record, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision !== record.revision) {
    throw new ApiError(409, 'This entry changed since you opened it. Refresh the list and try again.')
  }
}

async function validateAssets(content, env) {
  const allowedOwners = new Set(env.CMS_ADMIN_UIDS.split(',').map((value) => value.trim()).filter(Boolean))
  for (const key of mediaKeys(content)) {
    const match = key.match(/^portfolio\/([A-Za-z0-9_-]{1,128})\/[a-f0-9-]{36}$/)
    if (!match || !allowedOwners.has(match[1])) {
      throw new ApiError(422, 'An uploaded file reference is invalid.')
    }
    const object = await env.MEDIA.head(key)
    if (!object || object.customMetadata?.ownerUid !== match[1]) {
      throw new ApiError(403, 'An uploaded file is missing or does not belong to an administrator account.')
    }
  }
}

async function assertSlugAvailable(type, slug, id, env) {
  if (type !== 'projects') return
  const existing = await env.DB.prepare(
    'SELECT id FROM content_records WHERE (project_slug = ? OR published_slug = ?) AND id != ?',
  ).bind(slug, slug, id || '').first()
  if (existing) throw new ApiError(409, 'A project with this URL slug already exists. Choose a different slug.')
}

async function listRecords(type, env) {
  assertType(type)
  const result = await env.DB.prepare(
    `SELECT * FROM content_records WHERE type = ? AND status != ? ORDER BY json_extract(draft_data, '$.order') ASC, created_at DESC`,
  ).bind(type, 'deleted').all()
  return Promise.all(result.results.map((row) => adminRecord(recordFromRow(row), env)))
}

async function getRecord(type, id, env) {
  assertType(type)
  const row = await env.DB.prepare('SELECT * FROM content_records WHERE type = ? AND id = ? AND status != ?')
    .bind(type, id, 'deleted').first()
  return adminRecord(recordFromRow(row), env)
}

async function createRecord(type, content, actor, env) {
  assertType(type)
  const data = prepareStoredData(validateContent(type, content))
  await validateAssets(data, env)
  const id = crypto.randomUUID()
  await assertSlugAvailable(type, data.slug, id, env)
  const now = new Date().toISOString()
  await env.DB.prepare(
    'INSERT INTO content_records (id, type, status, revision, published_revision, draft_data, published_data, created_at, updated_at, author_id, published_by, published_at, project_slug, published_slug) VALUES (?, ?, ?, 1, 0, ?, NULL, ?, ?, ?, NULL, NULL, ?, NULL)',
  ).bind(id, type, 'draft', JSON.stringify(data), now, now, actor.uid, type === 'projects' ? data.slug : null).run()
  return getRecord(type, id, env)
}

async function saveRecord(type, id, body, actor, env) {
  assertType(type)
  const current = await env.DB.prepare('SELECT * FROM content_records WHERE type = ? AND id = ? AND status != ?')
    .bind(type, id, 'deleted').first()
  if (!current) throw new ApiError(404, 'Portfolio entry not found.')
  checkRevision(recordFromRow(current), body.expectedRevision)
  const data = prepareStoredData(validateContent(type, body.content))
  await validateAssets(data, env)
  await assertSlugAvailable(type, data.slug, id, env)
  const now = new Date().toISOString()
  const result = await env.DB.prepare(
    'UPDATE content_records SET draft_data = ?, revision = revision + 1, updated_at = ?, project_slug = ? WHERE type = ? AND id = ? AND revision = ? AND status != ?',
  ).bind(JSON.stringify(data), now, type === 'projects' ? data.slug : null, type, id, body.expectedRevision, 'deleted').run()
  if (!result.meta.changes) throw new ApiError(409, 'This entry changed since you opened it. Refresh the list and try again.')
  return getRecord(type, id, env)
}

async function publishRecord(type, id, expectedRevision, actor, env) {
  assertType(type)
  const current = await env.DB.prepare('SELECT * FROM content_records WHERE type = ? AND id = ? AND status != ?')
    .bind(type, id, 'deleted').first()
  if (!current) throw new ApiError(404, 'Portfolio entry not found.')
  const record = recordFromRow(current)
  checkRevision(record, expectedRevision)
  await validateAssets(record.draftData, env)
  const now = new Date().toISOString()
  const statements = [env.DB.prepare(
    'UPDATE content_records SET status = ?, published_data = draft_data, published_revision = revision, published_by = ?, published_at = ?, updated_at = ?, published_slug = project_slug WHERE type = ? AND id = ? AND revision = ? AND status != ?',
  ).bind('published', actor.uid, now, now, type, id, expectedRevision, 'deleted')]
  if (type === 'resumes' && record.draftData.isActive) {
    statements.push(env.DB.prepare(
      `UPDATE content_records
       SET published_data = json_set(published_data, '$.isActive', json('false')), updated_at = ?
       WHERE type = 'resumes' AND id != ? AND status = 'published'
       AND json_extract(published_data, '$.isActive') = 1
       AND EXISTS (
         SELECT 1 FROM content_records
         WHERE id = ? AND type = 'resumes' AND status = 'published' AND published_by = ? AND published_at = ?
       )`,
    ).bind(now, id, id, actor.uid, now))
  }
  const result = await env.DB.batch(statements)
  if (!result[0]?.meta?.changes) throw new ApiError(409, 'This entry changed since you opened it. Refresh the list and try again.')
  return getRecord(type, id, env)
}

async function unpublishRecord(type, id, actor, env) {
  assertType(type)
  const result = await env.DB.prepare(
    'UPDATE content_records SET status = ?, published_data = NULL, published_revision = 0, updated_at = ?, published_by = ?, published_slug = NULL WHERE type = ? AND id = ? AND status != ?',
  ).bind('draft', new Date().toISOString(), actor.uid, type, id, 'deleted').run()
  if (!result.meta.changes) throw new ApiError(404, 'Portfolio entry not found.')
  return getRecord(type, id, env)
}

async function deleteRecord(type, id, env) {
  assertType(type)
  const result = await env.DB.prepare(
    'UPDATE content_records SET status = ?, published_data = NULL, published_revision = 0, updated_at = ?, project_slug = NULL, published_slug = NULL WHERE type = ? AND id = ? AND status != ?',
  ).bind('deleted', new Date().toISOString(), type, id, 'deleted').run()
  if (!result.meta.changes) throw new ApiError(404, 'Portfolio entry not found.')
  return { id, deleted: true }
}

async function reorderRecords(type, ids, env) {
  assertType(type)
  if (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) {
    throw new ApiError(422, 'Choose a valid content order.')
  }
  const records = await listRecords(type, env)
  const byId = new Map(records.map((record) => [record.id, record]))
  const now = new Date().toISOString()
  const updates = ids.flatMap((id, order) => {
    const record = byId.get(id)
    if (!record) return []
    const draftData = { ...record.draftData, order }
    const publishedData = record.publishedData ? { ...record.publishedData, order } : null
    return [env.DB.prepare(
      'UPDATE content_records SET draft_data = ?, published_data = ?, revision = revision + 1, published_revision = CASE WHEN published_data IS NULL THEN published_revision ELSE revision + 1 END, updated_at = ? WHERE id = ?',
    ).bind(JSON.stringify(prepareStoredData(draftData)), publishedData ? JSON.stringify(prepareStoredData(publishedData)) : null, now, id)]
  })
  if (updates.length) await env.DB.batch(updates)
  return listRecords(type, env)
}

async function getSettings(env) {
  const row = await env.DB.prepare('SELECT * FROM content_records WHERE type = ? AND id = ? AND status != ?')
    .bind('settings', 'current', 'deleted').first()
  return adminRecord(recordFromRow(row), env)
}

async function saveSettings(body, actor, env) {
  const current = await env.DB.prepare('SELECT * FROM content_records WHERE type = ? AND id = ? AND status != ?')
    .bind('settings', 'current', 'deleted').first()
  const record = recordFromRow(current)
  checkRevision(record || { revision: 0 }, body.expectedRevision)
  const data = prepareStoredData(validateContent('settings', body.content))
  await validateAssets(data, env)
  const now = new Date().toISOString()
  if (!current) {
    await env.DB.prepare(
      'INSERT INTO content_records (id, type, status, revision, published_revision, draft_data, published_data, created_at, updated_at, author_id, published_by, published_at, project_slug) VALUES (?, ?, ?, 1, 0, ?, NULL, ?, ?, ?, NULL, NULL, NULL)',
    ).bind('current', 'settings', 'draft', JSON.stringify(data), now, now, actor.uid).run()
  } else {
    const result = await env.DB.prepare(
      'UPDATE content_records SET draft_data = ?, revision = revision + 1, updated_at = ? WHERE type = ? AND id = ? AND revision = ?',
    ).bind(JSON.stringify(data), now, 'settings', 'current', body.expectedRevision).run()
    if (!result.meta.changes) throw new ApiError(409, 'Settings changed since you opened them. Refresh and try again.')
  }
  return getSettings(env)
}

async function publishSettings(expectedRevision, actor, env) {
  const current = await env.DB.prepare('SELECT * FROM content_records WHERE type = ? AND id = ? AND status != ?')
    .bind('settings', 'current', 'deleted').first()
  if (!current) throw new ApiError(404, 'Save settings as a draft before publishing them.')
  checkRevision(recordFromRow(current), expectedRevision)
  await validateAssets(recordFromRow(current).draftData, env)
  const now = new Date().toISOString()
  const result = await env.DB.prepare(
    'UPDATE content_records SET status = ?, published_data = draft_data, published_revision = revision, published_by = ?, published_at = ?, updated_at = ? WHERE type = ? AND id = ? AND revision = ?',
  ).bind('published', actor.uid, now, now, 'settings', 'current', expectedRevision).run()
  if (!result.meta.changes) throw new ApiError(409, 'Settings changed since you opened them. Refresh and try again.')
  return getSettings(env)
}

function safeFileName(value) {
  const name = String(value || 'upload').replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(0, 180)
  return name || 'upload'
}

function validImage(bytes, contentType) {
  if (contentType === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
  if (contentType === 'image/png') {
    const start = [137, 80, 78, 71, 13, 10, 26, 10]
    const end = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]
    return bytes.length >= 20 && start.every((value, index) => bytes[index] === value) &&
      end.every((value, index) => bytes[bytes.length - end.length + index] === value)
  }
  if (contentType === 'image/webp') {
    const riffSize = bytes[4] | bytes[5] << 8 | bytes[6] << 16 | bytes[7] << 24
    return bytes.length >= 20 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' &&
      riffSize === bytes.length - 8 && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP'
  }
  return false
}

async function uploadFile(request, actor, env, url) {
  const kind = url.searchParams.get('kind')
  if (!['image', 'resume'].includes(kind)) throw new ApiError(422, 'Choose an image or PDF upload.')
  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const limit = kind === 'resume' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
  const length = Number(request.headers.get('content-length') || 0)
  if (length > limit) throw new ApiError(413, `The ${kind} file exceeds its size limit.`)
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (!bytes.length || bytes.length > limit) throw new ApiError(413, `The ${kind} file exceeds its size limit.`)
  if (kind === 'resume' && (contentType !== 'application/pdf' || !isValidPdfDocument(bytes))) {
    throw new ApiError(422, 'The upload is not a structurally valid PDF document.')
  }
  if (kind === 'image' && !validImage(bytes, contentType)) {
    throw new ApiError(422, 'The image contents do not match a supported JPEG, PNG, or WebP file.')
  }

  const extension = kind === 'resume' ? 'pdf' : ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[contentType]
  const key = `portfolio/${actor.uid}/${crypto.randomUUID()}`
  let requestedName = request.headers.get('x-file-name') || 'upload'
  try { requestedName = decodeURIComponent(requestedName) } catch {
    throw new ApiError(400, 'The uploaded file name is invalid.')
  }
  const fileName = safeFileName(requestedName)
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType, cacheControl: 'private, max-age=0, no-store' },
    customMetadata: { ownerUid: actor.uid, kind, originalName: fileName },
  })

  if (kind === 'resume') {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const content = resumeSchema.parse({
      title: fileName.replace(/\.pdf$/i, ''),
      fileName: fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`,
      sizeKB: Math.max(0.01, Math.ceil(bytes.length / 1024)),
      version: '1.0', storagePath: key, mediaProvider: 'cloudflare-r2',
      isActive: false, visibility: true, order: Date.now(),
    })
    try {
      await env.DB.prepare(
        'INSERT INTO content_records (id, type, status, revision, published_revision, draft_data, published_data, created_at, updated_at, author_id, published_by, published_at, project_slug) VALUES (?, ?, ?, 1, 0, ?, NULL, ?, ?, ?, NULL, NULL, NULL)',
      ).bind(id, 'resumes', 'draft', JSON.stringify(prepareStoredData(content)), now, now, actor.uid).run()
    } catch {
      await env.MEDIA.delete(key)
      throw new ApiError(503, 'The resume was uploaded but could not be added to the portfolio. Check the D1 migration and retry.')
    }
    return adminRecord(recordFromRow(await env.DB.prepare('SELECT * FROM content_records WHERE id = ?').bind(id).first()), env)
  }

  return {
    url: await signMediaUrl(key, env),
    storagePath: key,
    mediaProvider: 'cloudflare-r2',
    format: extension,
    caption: '',
    order: 0,
    fileName,
    bytes: bytes.length,
  }
}

async function serveMedia(url, env) {
  const key = url.searchParams.get('key') || ''
  const expires = Number(url.searchParams.get('expires'))
  const signature = url.searchParams.get('sig') || ''
  const now = Math.floor(Date.now() / 1000)
  if (
    !/^portfolio\/[A-Za-z0-9_-]{1,128}\/[a-f0-9-]{36}$/.test(key) ||
    !Number.isInteger(expires) || expires <= now || expires > now + SIGNED_MEDIA_TTL ||
    !/^[a-f0-9]{64}$/.test(signature)
  ) throw new ApiError(403, 'This media link is invalid or has expired.')

  const signingKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.MEDIA_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const valid = await crypto.subtle.verify(
    'HMAC',
    signingKey,
    Uint8Array.from(signature.match(/.{2}/g), (byte) => parseInt(byte, 16)),
    new TextEncoder().encode(`${key}:${expires}`),
  )
  if (!valid) throw new ApiError(403, 'This media link is invalid or has expired.')
  const object = await env.MEDIA.get(key)
  if (!object) throw new ApiError(404, 'The uploaded file is no longer available.')
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('cache-control', `private, max-age=${Math.min(expires - now, 300)}`)
  headers.set('x-content-type-options', 'nosniff')
  headers.set('content-disposition', 'inline')
  return new Response(object.body, { headers })
}

async function publishedContent(type, env) {
  if (type === 'settings') {
    const row = await env.DB.prepare('SELECT * FROM content_records WHERE type = ? AND id = ? AND status = ?')
      .bind('settings', 'current', 'published').first()
    const record = recordFromRow(row)
    return record ? hydrateMedia(record.publishedData, env) : null
  }
  assertType(type)
  const result = await env.DB.prepare(
    `SELECT * FROM content_records WHERE type = ? AND status = ? ORDER BY json_extract(published_data, '$.order') ASC, published_at DESC`,
  ).bind(type, 'published').all()
  const content = await Promise.all(result.results.map(async (row) => publicRecord(type, recordFromRow(row), env)))
  return content.filter(Boolean)
}

async function health(env) {
  if (!configReady(env)) return json({ ready: false })
  try {
    await env.DB.prepare('SELECT 1 AS ready').first()
    await env.MEDIA.list({ limit: 1 })
    return json({ ready: true })
  } catch {
    return json('Portfolio storage is configured but not responding. Check the D1 and R2 bindings and retry.', 503)
  }
}

async function route(request, env) {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'allow': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' } })
  if (path === '/api/health' && request.method === 'GET') return health(env)
  requireConfig(env)
  if (path === '/api/media' && request.method === 'GET') return serveMedia(url, env)

  if (path.startsWith('/api/public/')) {
    if (path === '/api/public/settings' && request.method === 'GET') return json(await publishedContent('settings', env), 200, true)
    const match = path.match(/^\/api\/public\/content\/([^/]+)(?:\/([^/]+))?$/)
    if (match && request.method === 'GET') {
      const type = decodeURIComponent(match[1])
      const id = match[2] ? decodeURIComponent(match[2]) : null
      if (id) {
        assertType(type)
        const row = await env.DB.prepare('SELECT * FROM content_records WHERE type = ? AND id = ? AND status = ?')
          .bind(type, id, 'published').first()
        const item = await publicRecord(type, recordFromRow(row), env)
        if (!item) throw new ApiError(404, 'Published portfolio entry not found.')
        return json(item, 200, true)
      }
      return json(await publishedContent(type, env), 200, true)
    }
    if (path === '/api/public/resume' && request.method === 'GET') {
      const id = url.searchParams.get('id')
      const row = id
        ? await env.DB.prepare('SELECT * FROM content_records WHERE type = ? AND id = ? AND status = ?')
          .bind('resumes', id, 'published').first()
        : await env.DB.prepare("SELECT * FROM content_records WHERE type = 'resumes' AND status = 'published' AND json_extract(published_data, '$.isActive') = 1 LIMIT 1").first()
      const content = row ? recordFromRow(row).publishedData : null
      if (!content?.isActive || !content.visibility || !content.storagePath) throw new ApiError(404, 'No published resume is available.')
      const mediaUrl = await signMediaUrl(content.storagePath, env)
      return Response.redirect(new URL(mediaUrl, url.origin), 302)
    }
    throw new ApiError(404, 'API route not found.')
  }

  if (!path.startsWith('/api/admin/')) throw new ApiError(404, 'API route not found.')
  const actor = await verifyAdmin(request, env)
  if (path === '/api/admin/uploads' && request.method === 'POST') {
    return json(await uploadFile(request, actor, env, url), 201)
  }
  if (path === '/api/admin/settings' && request.method === 'GET') return json(await getSettings(env))
  if (path === '/api/admin/settings' && request.method === 'PUT') {
    return json(await saveSettings(await readJson(request), actor, env))
  }
  if (path === '/api/admin/settings/publish' && request.method === 'POST') {
    const body = await readJson(request)
    return json(await publishSettings(body.expectedRevision, actor, env))
  }

  const reorderPath = path.match(/^\/api\/admin\/content\/([^/]+)\/reorder$/)
  if (reorderPath && request.method === 'PATCH') {
    const body = await readJson(request)
    return json(await reorderRecords(decodeURIComponent(reorderPath[1]), body.ids, env))
  }

  const contentPath = path.match(/^\/api\/admin\/content\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/)
  if (!contentPath) throw new ApiError(404, 'API route not found.')
  const type = decodeURIComponent(contentPath[1])
  const id = contentPath[2] ? decodeURIComponent(contentPath[2]) : null
  const action = contentPath[3] || null
  if (!id && !action && request.method === 'GET') return json(await listRecords(type, env))
  if (!id && !action && request.method === 'POST') {
    const body = await readJson(request)
    return json(await createRecord(type, body.content, actor, env), 201)
  }
  if (id && !action && request.method === 'GET') {
    const record = await getRecord(type, id, env)
    if (!record) throw new ApiError(404, 'Portfolio entry not found.')
    return json(record)
  }
  if (id && !action && request.method === 'PUT') return json(await saveRecord(type, id, await readJson(request), actor, env))
  if (id && action === 'publish' && request.method === 'POST') {
    const body = await readJson(request)
    return json(await publishRecord(type, id, body.expectedRevision, actor, env))
  }
  if (id && action === 'unpublish' && request.method === 'POST') return json(await unpublishRecord(type, id, actor, env))
  if (id && !action && request.method === 'DELETE') return json(await deleteRecord(type, id, env))
  throw new ApiError(404, 'API route not found.')
}

export async function handleRequest(request, env) {
  try {
    return await route(request, env)
  } catch (error) {
    if (error instanceof ApiError) return json(error.message, error.status)
    if (error?.name === 'ZodError') return json('Some fields are invalid. Review the form and try again.', 422)
    console.error('Portfolio API request failed:', error instanceof Error ? error.message : 'Unknown error')
    return json('The portfolio service could not complete the request. Check the Cloudflare D1 migration and storage bindings.', 500)
  }
}

export async function onRequest(context) {
  return handleRequest(context.request, context.env)
}
