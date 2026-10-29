import { contentSchemas, parseContent, siteSettingsSchema } from './db/contentSchemas.js'
import { isValidPdfDocument } from './db/pdfValidation.js'

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024
export const MAX_RESUME_BYTES = 5 * 1024 * 1024
export const PRIVATE_BUCKET = 'portfolio-private'
export const PUBLIC_BUCKET = 'portfolio-published'
export const LEGACY_STORAGE_BUCKETS = Object.freeze(['portfolio-media.', 'portfolio-media', 'portfolio_media'])
const sourceBuckets = new Set([PRIVATE_BUCKET, ...LEGACY_STORAGE_BUCKETS])

const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const contentTypes = new Set([...Object.keys(contentSchemas)])
const systemFields = new Set([
  'id', 'status', 'revision', 'publishedRevision', 'basePublishedRevision',
  'createdAt', 'updatedAt', 'publishedAt', 'publishedBy', 'updatedBy', 'deletedAt',
])

export class SupabaseCmsError extends Error {
  constructor(state, message, cause) {
    super(message, { cause })
    this.name = 'SupabaseCmsError'
    this.state = state
    this.status = state === 'auth' ? 401 : state === 'conflict' ? 409 : 0
  }
}

export function sanitizeSupabaseError(error) {
  const code = error?.code || ''
  if (code === '42501' || code === 'PGRST301' || error?.status === 401 || error?.status === 403) {
    return new SupabaseCmsError('auth', 'Your account is not authorized to manage this portfolio.', error)
  }
  if (code === '40001' || code === '23505' || code === '23503') {
    return new SupabaseCmsError('conflict', error?.message || 'This content changed. Reload and try again.', error)
  }
  if (code === '22023' || error?.status === 413 || error?.status === 415) {
    return new SupabaseCmsError('validation', error?.message || 'The submitted content is invalid.', error)
  }
  return new SupabaseCmsError('serverError', error?.message || 'The Supabase CMS request failed.', error)
}

function assertType(type) {
  if (!contentTypes.has(type)) {
    throw new SupabaseCmsError('validation', `Unsupported CMS content type: ${type}.`)
  }
}

function withoutSystemFields(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => !systemFields.has(key)))
}

function safeFileName(value) {
  const base = String(value || 'upload').normalize('NFKC')
    .replace(/[\\/\0-\x1f<>:"|?*]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 120)
  return base || 'upload'
}

export async function validateSupabaseUpload(file, kind = 'image') {
  if (kind !== 'image' && kind !== 'resume') {
    throw new SupabaseCmsError('validation', 'Choose an image or PDF resume.')
  }
  if (!file || typeof file.arrayBuffer !== 'function' || file.size <= 0) {
    throw new SupabaseCmsError('validation', 'Choose a non-empty local file.')
  }
  const isResume = kind === 'resume'
  const maximum = isResume ? MAX_RESUME_BYTES : MAX_IMAGE_BYTES
  if (file.size > maximum) {
    throw new SupabaseCmsError('validation', `Choose a file no larger than ${isResume ? '5 MB' : '12 MB'}.`)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (isResume) {
    if (file.type !== 'application/pdf' || !isValidPdfDocument(bytes)) {
      throw new SupabaseCmsError('validation', 'The selected file is not a valid PDF document.')
    }
    return { bytes, contentType: 'application/pdf', kind }
  }

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const isPng = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    .every((byte, index) => bytes[index] === byte)
  const isWebp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  const signatureMatchesMime = (isJpeg && file.type === 'image/jpeg')
    || (isPng && file.type === 'image/png')
    || (isWebp && file.type === 'image/webp')
  if (!MIME_TYPES.has(file.type) || !signatureMatchesMime) {
    throw new SupabaseCmsError('validation', 'The file contents must match a supported JPEG, PNG, or WebP image.')
  }
  return { bytes, contentType: file.type, kind }
}

function assertRpc(client, name, args) {
  return client.rpc(name, args).then(({ data, error }) => {
    if (error) throw sanitizeSupabaseError(error)
    return data
  }).catch((error) => {
    if (error instanceof SupabaseCmsError) throw error
    throw sanitizeSupabaseError(error)
  })
}

function storageBucketAndPath(storagePath) {
  const separator = storagePath.indexOf('/')
  if (separator <= 0) return null
  const bucket = storagePath.slice(0, separator)
  if (!sourceBuckets.has(bucket) && bucket !== PUBLIC_BUCKET) return null
  return { bucket, path: storagePath.slice(separator + 1) }
}

function walkAssets(value, transform) {
  if (Array.isArray(value)) return Promise.all(value.map((item) => walkAssets(item, transform)))
  if (!value || typeof value !== 'object') return Promise.resolve(value)
  return Promise.all(Object.entries(value).map(async ([key, item]) => [key, await walkAssets(item, transform)]))
    .then(async (entries) => {
      const result = Object.fromEntries(entries)
      return result.storagePath ? transform(result) : result
    })
}

function collectStoragePaths(value, bucketName) {
  const paths = new Set()
  const visit = (item) => {
    if (!item || typeof item !== 'object') return
    if (typeof item.storagePath === 'string') {
      const parsed = storageBucketAndPath(item.storagePath)
      if (parsed?.bucket === bucketName) paths.add(item.storagePath)
    }
    if (Array.isArray(item)) item.forEach(visit)
    else Object.values(item).forEach(visit)
  }
  visit(value)
  return [...paths]
}

async function throwStorageError(error, operation) {
  if (error) throw new SupabaseCmsError('upload', `Supabase Storage ${operation} failed: ${error.message || 'unknown error'}`, error)
}

function recordFromRpc(value, type, view = 'drafts') {
  if (!value || !value.id) return null
  const timestamp = (date) => {
    if (!date) return null
    if (typeof date === 'object' && Number.isFinite(date.seconds)) return date
    const seconds = Math.floor(new Date(date).getTime() / 1000)
    return Number.isFinite(seconds) ? { seconds } : null
  }
  return {
    ...value,
    ...withoutSystemFields(value),
    createdAt: timestamp(value.createdAt),
    updatedAt: timestamp(value.updatedAt),
    publishedAt: timestamp(value.publishedAt),
    status: value.status || (view === 'published' ? 'published' : 'draft'),
  }
}

function createCmsApi(client) {
  if (!client) throw new SupabaseCmsError('unconfigured', 'Supabase is not configured.')

  async function signedUrl(storagePath, download) {
    const parsed = storageBucketAndPath(storagePath)
    if (!parsed) return ''
    const { data, error } = await client.storage.from(parsed.bucket).createSignedUrl(
      parsed.path,
      60 * 60,
      download ? { download } : {},
    )
    await throwStorageError(error, 'signing')
    return data.signedUrl
  }

  async function hydratePrivateAssets(value) {
    return walkAssets(value, async (asset) => {
      const parsed = storageBucketAndPath(asset.storagePath)
      if (!parsed || !sourceBuckets.has(parsed.bucket)) return asset
      const url = await signedUrl(asset.storagePath)
      const result = { ...asset }
      if ('url' in result) result.url = url
      if ('fileUrl' in result) result.fileUrl = await signedUrl(asset.storagePath, asset.fileName || true)
      if ('previewUrl' in result) result.previewUrl = url
      return result
    })
  }

  async function uploadFile(file, bucket, path, contentType, onProgress) {
    onProgress(5)
    const { error } = await client.storage.from(bucket).upload(path, file, {
      contentType,
      cacheControl: '3600',
      upsert: true,
    })
    await throwStorageError(error, 'upload')
    onProgress(85)
  }

  async function publicUrl(storagePath) {
    const parsed = storageBucketAndPath(storagePath)
    if (parsed?.bucket !== PUBLIC_BUCKET) return ''
    return client.storage.from(PUBLIC_BUCKET).getPublicUrl(parsed.path).data.publicUrl
  }

  async function preparePublishedAssets(value) {
    const sources = []
    const result = await walkAssets(value, async (asset) => {
      const source = storageBucketAndPath(asset.storagePath)
      if (!source || !sourceBuckets.has(source.bucket)) return asset
      const destinationPath = `published/${source.path}`
      const destinationStoragePath = `${PUBLIC_BUCKET}/${destinationPath}`
      sources.push({ sourceBucket: source.bucket, sourcePath: source.path, destinationPath })
      const url = await publicUrl(destinationStoragePath)
      return {
        ...asset,
        storagePath: destinationStoragePath,
        ...(asset.url ? { url } : {}),
        ...(asset.fileUrl ? { fileUrl: url } : {}),
        ...(asset.previewUrl ? { previewUrl: url } : {}),
      }
    })
    return { value: result, sources }
  }

  async function copyPublishedAssets(sources) {
    const copiedPaths = []
    try {
      for (const source of sources) {
        const destination = client.storage.from(PUBLIC_BUCKET)
        const fileName = source.destinationPath.split('/').at(-1)
        const folder = source.destinationPath.split('/').slice(0, -1).join('/')
        const { data: existing, error: listError } = await destination.list(folder, {
          search: fileName,
          limit: 1,
        })
        await throwStorageError(listError, 'checking published assets')
        if (existing?.some((entry) => entry.name === fileName)) continue
        const { error } = await client.storage.from(source.sourceBucket)
          .copy(source.sourcePath, PUBLIC_BUCKET, source.destinationPath)
        await throwStorageError(error, 'publishing an asset')
        copiedPaths.push(`${PUBLIC_BUCKET}/${source.destinationPath}`)
      }
      return copiedPaths
    } catch (error) {
      const failure = new Error(error?.message || 'Supabase Storage could not publish an asset.', { cause: error })
      failure.publishedAssetPaths = copiedPaths
      throw failure
    }
  }

  async function uploadRecord(type, id, payload, expectedRevision = 0) {
    const record = await assertRpc(client, 'cms_save_record', {
      p_type: type,
      p_id: id || null,
      p_payload: payload,
      p_expected_revision: expectedRevision,
    })
    return recordFromRpc(record, type)
  }

  async function list(type, view = 'drafts') {
    assertType(type)
    const value = await assertRpc(client, 'cms_list_records', { p_type: type, p_view: view })
    if (!Array.isArray(value)) throw new SupabaseCmsError('serverError', 'Supabase returned an invalid CMS collection.')
    const records = await Promise.all(value.map((row) => hydratePrivateAssets(recordFromRpc(row, type, view))))
    if (type !== 'media') return records
    const paths = new Set(records.map((record) => record.storagePath).filter(Boolean))
    if (!paths.size) return records.map((record) => ({ ...record, usedIn: [] }))
    const usage = new Map([...paths].map((path) => [path, []]))
    for (const relatedType of ['projects', 'resumes']) {
      const related = [
        ...await api.list(relatedType, 'drafts'),
        ...await api.list(relatedType, 'published'),
      ]
      for (const record of related) {
        const label = record.title || record.slug || record.fileName || record.role || record.degree || 'Portfolio content'
        for (const bucketName of [PRIVATE_BUCKET, ...LEGACY_STORAGE_BUCKETS, PUBLIC_BUCKET]) {
          for (const path of collectStoragePaths(record, bucketName)) {
            if (usage.has(path) && !usage.get(path).includes(label)) usage.get(path).push(label)
          }
        }
      }
    }
    return records.map((record) => ({ ...record, usedIn: usage.get(record.storagePath) || [] }))
  }

  const api = {
    async health() {
      const value = await assertRpc(client, 'cms_health', {})
      const checks = await Promise.all([PRIVATE_BUCKET, PUBLIC_BUCKET].map(async (bucket) => {
        const { error } = await client.storage.from(bucket).list('', { limit: 1 })
        return error ? `${bucket}: ${error.message || 'Storage API is unavailable.'}` : ''
      }))
      const storageMessage = checks.find(Boolean) || value?.storage?.message || ''
      return {
        ...value,
        storage: {
          ...value?.storage,
          ready: value?.storage?.ready === true && !checks.some(Boolean),
          message: storageMessage,
        },
      }
    },
    list,
    async get(type, id, view = 'drafts') {
      assertType(type)
      const value = await assertRpc(client, 'cms_get_record', { p_type: type, p_id: id, p_view: view })
      return hydratePrivateAssets(recordFromRpc(value, type, view))
    },
    async create(type, content) {
      assertType(type)
      return uploadRecord(type, null, parseContent(type, content), 0)
    },
    async save(type, id, content, expectedRevision = 0) {
      assertType(type)
      return uploadRecord(type, id, parseContent(type, content), expectedRevision)
    },
    async publish(type, id, expectedRevision) {
      assertType(type)
      const draft = await api.get(type, id, 'drafts')
      if (!draft) throw new SupabaseCmsError('not_found', 'Draft was not found.')
      const previouslyPublished = type === 'resumes' ? await list('resumes', 'published') : []
      const revision = Number.isInteger(expectedRevision) ? expectedRevision : draft.revision
      const prepared = await preparePublishedAssets(withoutSystemFields(draft))
      if (prepared.sources.length || collectStoragePaths(draft, PUBLIC_BUCKET).length) {
        const health = await assertRpc(client, 'cms_health', {})
        if (health?.storage?.ready !== true) {
          throw new SupabaseCmsError(
            'upload',
            health?.storage?.message || 'Published asset storage has not been verified and enabled.',
          )
        }
      }
      const payload = parseContent(type, prepared.value)
      const result = await assertRpc(client, 'cms_publish_record', {
        p_type: type,
        p_id: id,
        p_expected_revision: revision,
        p_payload: payload,
      })
      let copiedPaths = []
      try {
        copiedPaths = await copyPublishedAssets(prepared.sources)
      } catch (error) {
        copiedPaths = error.publishedAssetPaths || []
        let rollbackError
        try {
          await assertRpc(client, 'cms_unpublish_record', { p_type: type, p_id: id })
        } catch (caughtRollbackError) {
          rollbackError = caughtRollbackError
        }
        let cleanupError
        if (copiedPaths.length) {
          try {
            const cleanup = await client.storage.from(PUBLIC_BUCKET).remove(
              copiedPaths.map((path) => path.slice(PUBLIC_BUCKET.length + 1)),
            )
            cleanupError = cleanup.error
          } catch (caughtCleanupError) {
            cleanupError = caughtCleanupError
          }
        }
        if (rollbackError) {
          throw new SupabaseCmsError(
            'serverError',
            `The record was published but its assets could not be copied, and the published record could not be withdrawn: ${rollbackError.message}.${cleanupError ? ` Staged public assets could not be removed: ${cleanupError.message || 'unknown error'}.` : ' Successfully copied staged assets were removed.'} The original uploads remain private.`,
            rollbackError,
          )
        }
        if (cleanupError) {
          throw new SupabaseCmsError(
            'upload',
            `The record was withdrawn, but staged public assets could not be removed: ${cleanupError.message}. The original uploads remain private.`,
            cleanupError,
          )
        }
        if (type === 'resumes') {
          try {
            for (const previous of previouslyPublished) {
              const current = await api.get('resumes', previous.id, 'drafts')
              if (!current) continue
              await assertRpc(client, 'cms_publish_record', {
                p_type: 'resumes',
                p_id: previous.id,
                p_expected_revision: current.revision,
                p_payload: parseContent('resumes', withoutSystemFields(previous)),
              })
            }
          } catch (restoreError) {
            throw new SupabaseCmsError(
              'serverError',
              `The new resume was withdrawn, but the previously published resume could not be restored: ${restoreError.message}`,
              restoreError,
            )
          }
        }
        throw new SupabaseCmsError(
          'upload',
          `Publishing was rolled back because an asset could not be copied. The original upload remains private. ${error.message}`,
          error,
        )
      }
      try {
        if (type === 'projects') {
          const paths = new Set(prepared.sources.map((source) => `${source.sourceBucket}/${source.sourcePath}`))
          const media = await list('media', 'drafts')
          for (const item of media) {
            if (![...sourceBuckets].some((bucket) => collectStoragePaths(item, bucket).some((path) => paths.has(path)))) continue
            await api.publish('media', item.id, item.revision)
          }
        } else if (type === 'resumes') {
          const retiredPaths = previouslyPublished
            .filter((record) => record.id !== id)
            .flatMap((record) => collectStoragePaths(record, PUBLIC_BUCKET))
          await removeUnreferencedPublicAssets(retiredPaths)
        }
        return recordFromRpc(result, type, 'published')
      } catch (error) {
        throw new SupabaseCmsError('serverError', `The ${type} content was published, but related asset cleanup or media updates failed: ${error.message}`, error)
      }
    },
    async unpublish(type, id) {
      assertType(type)
      const prior = await api.get(type, id, 'published')
      const result = await assertRpc(client, 'cms_unpublish_record', { p_type: type, p_id: id })
      await removeUnreferencedPublicAssets(collectStoragePaths(prior, PUBLIC_BUCKET))
      return result
    },
    async deleteItem(type, id) {
      assertType(type)
      const prior = await api.get(type, id)
      const published = await api.get(type, id, 'published')
      const result = await assertRpc(client, 'cms_delete_record', { p_type: type, p_id: id })
      await removeUnreferencedPublicAssets([
        ...collectStoragePaths(prior, PUBLIC_BUCKET),
        ...collectStoragePaths(published, PUBLIC_BUCKET),
      ])
      await removeUnreferencedPrivateAssets([
        ...collectStoragePaths(prior, PRIVATE_BUCKET),
      ])
      return result
    },
    async reorder(type, items) {
      assertType(type)
      return assertRpc(client, 'cms_reorder_records', { p_type: type, p_items: items })
    },
    async removeMedia(id) {
      return api.deleteItem('media', id)
    },
    async getSettings(view = 'drafts') {
      const value = await assertRpc(client, 'cms_get_settings', { p_view: view })
      return hydratePrivateAssets(recordFromRpc(value, 'settings', view))
    },
    async saveSettings(content, expectedRevision = 0) {
      const value = await assertRpc(client, 'cms_save_settings', {
        p_payload: siteSettingsSchema.parse(content),
        p_expected_revision: expectedRevision,
      })
      return recordFromRpc(value, 'settings')
    },
    async publishSettings(expectedRevision) {
      const value = await assertRpc(client, 'cms_publish_settings', { p_expected_revision: expectedRevision })
      return recordFromRpc(value, 'settings', 'published')
    },
    async unpublishSettings() {
      return assertRpc(client, 'cms_unpublish_settings', {})
    },
    async importImage(sourceUrl, alt = '', { private: privateUpload = false } = {}) {
      let url
      try { url = new URL(sourceUrl) } catch { throw new SupabaseCmsError('validation', 'Enter a valid image URL.') }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new SupabaseCmsError('validation', 'Image URL must use HTTP or HTTPS and must not contain credentials.')
      }
      let response
      try {
        response = await fetch(url.href, { mode: 'cors', credentials: 'omit', redirect: 'error' })
      } catch (error) {
        throw new SupabaseCmsError('upload', 'Could not fetch that image from this browser. Check the URL or download and upload the image file instead.', error)
      }
      if (!response.ok) throw new SupabaseCmsError('upload', `The image source returned HTTP ${response.status}.`)
      const blob = await response.blob()
      const type = blob.type.split(';')[0].trim().toLowerCase()
      const file = new File([blob], safeFileName(url.pathname.split('/').at(-1)), { type })
      return api.upload(file, { kind: 'image', alt, private: privateUpload, sourceUrl: url.href })
    },
    async upload(file, {
      kind = 'image',
      alt = '',
      replaceMediaId = '',
      private: privateUpload = false,
      sourceUrl = '',
      onProgress = () => {},
    } = {}) {
      const checked = await validateSupabaseUpload(file, kind)
      const privateAsset = privateUpload || kind === 'resume'
      const publishImmediately = !privateAsset && kind === 'image'
      const existing = replaceMediaId ? await api.get('media', replaceMediaId, 'drafts') : null
      const existingPath = storageBucketAndPath(existing?.storagePath || '')
      const bucket = PRIVATE_BUCKET
      const id = replaceMediaId || crypto.randomUUID()
      const authResult = await client.auth.getUser()
      if (authResult?.error) throw sanitizeSupabaseError(authResult.error)
      const userId = authResult?.data?.user?.id
      if (!userId || await assertRpc(client, 'cms_is_admin', {}) !== true) {
        throw new SupabaseCmsError('auth', 'Sign in with the registered portfolio administrator account before uploading.')
      }
      const path = `drafts/${userId}/${id}/${crypto.randomUUID()}/${safeFileName(file.name)}`
      const storagePath = `${bucket}/${path}`
      const onProgressSafe = typeof onProgress === 'function' ? onProgress : () => {}
      let recordSaved = false
      try {
        await uploadFile(file, bucket, path, checked.contentType, onProgressSafe)
        let dimensions = {}
        if (kind === 'image' && typeof createImageBitmap === 'function') {
          const image = await createImageBitmap(file)
          dimensions = { width: image.width, height: image.height }
          image.close()
        }
        const url = await signedUrl(storagePath)

        if (kind === 'resume') {
          const resumes = await list('resumes', 'drafts')
          const version = 1 + Math.max(0, ...resumes.map((record) => Number(record.version) || 0))
          const resumeUrl = await signedUrl(storagePath, file.name)
          const payload = {
            fileUrl: resumeUrl,
            previewUrl: url,
            storagePath,
            fileName: file.name || `resume-v${version}.pdf`,
            sizeKB: Number((file.size / 1024).toFixed(2)),
            version: String(version),
            notes: '',
            isActive: false,
            visibility: true,
            order: version - 1,
          }
          const saved = await uploadRecord('resumes', null, parseContent('resumes', payload), 0)
          recordSaved = true
          onProgressSafe(100)
          return saved
        }

        const content = {
          url,
          storagePath,
          type: 'image',
          sizeBytes: file.size,
          fileName: file.name || 'image',
          mimeType: checked.contentType,
          ...dimensions,
          sourceUrl,
          alt: alt || existing?.alt || '',
          usedIn: existing?.usedIn || [],
          visibility: true,
          order: existing?.order ?? Date.now(),
        }
        let saved = await uploadRecord(
          'media',
          existing?.id || id,
          parseContent('media', content),
          existing?.revision || 0,
        )
        recordSaved = true
        if (publishImmediately) saved = await api.publish('media', saved.id, saved.revision)
        if (existingPath?.bucket === PUBLIC_BUCKET) {
          await removeUnreferencedPublicAssets([existing.storagePath])
        } else if (existingPath?.bucket === PRIVATE_BUCKET) {
          await removeUnreferencedPrivateAssets([existing.storagePath])
        }
        onProgressSafe(100)
        return saved
      } catch (error) {
        if (!recordSaved) {
          const { error: cleanupError } = await client.storage.from(bucket).remove([path])
          if (cleanupError) {
            throw new SupabaseCmsError('upload', `${error.message} The uncommitted upload could not be removed: ${cleanupError.message}`, cleanupError)
          }
        }
        throw error
      }
    },
  }

  async function publicStorageReferences() {
    const references = new Set()
    for (const type of contentTypes) {
      const records = await api.list(type, 'published')
      for (const record of records) {
        for (const path of collectStoragePaths(record, PUBLIC_BUCKET)) references.add(path)
      }
    }
    const settings = await api.getSettings('published')
    for (const path of collectStoragePaths(settings, PUBLIC_BUCKET)) references.add(path)
    return references
  }

  async function removeUnreferencedPublicAssets(paths) {
    const candidates = [...new Set(paths)]
    if (!candidates.length) return
    const references = await publicStorageReferences()
    const unused = candidates.filter((path) => !references.has(path))
    if (!unused.length) return
    const { error } = await client.storage.from(PUBLIC_BUCKET).remove(
      unused.map((path) => path.slice(PUBLIC_BUCKET.length + 1)),
    )
    await throwStorageError(error, 'deleting unreferenced published assets')
  }

  async function removeUnreferencedPrivateAssets(paths) {
    const candidates = [...new Set(paths)]
    if (!candidates.length) return
    const references = new Set()
    for (const type of contentTypes) {
      const records = await api.list(type, 'drafts')
      for (const record of records) {
        for (const path of collectStoragePaths(record, PRIVATE_BUCKET)) references.add(path)
      }
    }
    const settings = await api.getSettings('drafts')
    for (const path of collectStoragePaths(settings, PRIVATE_BUCKET)) references.add(path)
    const unused = candidates.filter((path) => !references.has(path))
    if (!unused.length) return
    const { error } = await client.storage.from(PRIVATE_BUCKET).remove(
      unused.map((path) => path.slice(PRIVATE_BUCKET.length + 1)),
    )
    await throwStorageError(error, 'deleting unreferenced draft assets')
  }

  return api
}

export const createSupabaseCmsApi = createCmsApi
