import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createSupabaseCmsApi,
  getSupabaseCmsReadiness,
  LEGACY_STORAGE_BUCKETS,
  MAX_IMAGE_BYTES,
  PRIVATE_BUCKET,
  PUBLIC_BUCKET,
  sanitizeSupabaseError,
  SupabaseCmsError,
  validateSupabaseUpload,
} from '../src/lib/supabaseCmsApi.js'
import { projectSchema } from '../src/lib/db/contentSchemas.js'

function project(overrides = {}) {
  return projectSchema.parse({
    title: 'Editorial project',
    slug: 'editorial-project',
    category: 'Web',
    ...overrides,
  })
}

function mockClient(rpc, { isAdmin = true, userId = '11111111-1111-4111-8111-111111111111' } = {}) {
  const storageCalls = []
  const storage = {
    from(bucket) {
      return {
        async createSignedUrl(path) {
          storageCalls.push(['signed', bucket, path])
          return { data: { signedUrl: `https://signed.example/${path}` }, error: null }
        },
        async upload(path) {
          storageCalls.push(['upload', bucket, path])
          return { error: null }
        },
        async download(path) {
          storageCalls.push(['download', bucket, path])
          return { data: { type: 'image/png' }, error: null }
        },
        async list(path, options) {
          storageCalls.push(['list', bucket, path, options])
          return { data: [], error: null }
        },
        async copy(source, destinationBucket, destination) {
          storageCalls.push(['copy', bucket, source, destinationBucket, destination])
          return { error: null }
        },
        getPublicUrl(path) {
          storageCalls.push(['public-url', bucket, path])
          return { data: { publicUrl: `https://public.example/${path}` } }
        },
        async remove(paths) {
          storageCalls.push(['remove', bucket, paths])
          return { error: null }
        },
      }
    },
  }
  return {
    storage,
    storageCalls,
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
    rpc: async (name, args) => name === 'cms_is_admin'
      ? { data: isAdmin, error: null }
      : rpc(name, args),
  }
}

function imageFile({ type = 'image/png', bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], size } = {}) {
  const data = new Uint8Array(bytes)
  return {
    name: 'preview.png',
    type,
    size: size ?? data.byteLength,
    arrayBuffer: async () => data.buffer,
  }
}

function validPdfFile() {
  let text = '%PDF-1.4\n'
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
  ]
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(text, 'latin1'))
    text += object
  }
  const xrefOffset = Buffer.byteLength(text, 'latin1')
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  const data = Buffer.from(text, 'latin1')
  return {
    name: 'resume.pdf',
    type: 'application/pdf',
    size: data.byteLength,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  }
}

test('upload validation accepts supported image signatures and rejects mismatched content', async () => {
  const validated = await validateSupabaseUpload(imageFile())
  assert.equal(validated.contentType, 'image/png')
  assert.equal(validated.kind, 'image')

  await assert.rejects(
    validateSupabaseUpload(imageFile({ type: 'image/jpeg' })),
    (error) => error instanceof SupabaseCmsError && error.state === 'validation',
  )
  await assert.rejects(
    validateSupabaseUpload(imageFile({ size: MAX_IMAGE_BYTES + 1 })),
    (error) => error instanceof SupabaseCmsError && /12 MB/.test(error.message),
  )
})

test('resume validation accepts structurally valid PDFs and rejects non-PDF bytes', async () => {
  const validated = await validateSupabaseUpload(validPdfFile(), 'resume')
  assert.equal(validated.contentType, 'application/pdf')
  assert.equal(validated.kind, 'resume')
  await assert.rejects(
    validateSupabaseUpload(imageFile({ type: 'application/pdf' }), 'resume'),
    (error) => error instanceof SupabaseCmsError && error.state === 'validation',
  )
})

test('health separates Storage reachability from the publication audit gate', async () => {
  const client = mockClient(async (name) => {
    assert.equal(name, 'cms_health')
    return {
      data: {
        ok: true,
        admin: true,
        database: { ready: true },
        storage: {
          ready: false,
          message: 'A trusted operator must review the public bucket.',
        },
      },
      error: null,
    }
  })
  const api = createSupabaseCmsApi(client)
  const health = await api.health()

  assert.equal(health.database.ready, true)
  assert.equal(health.storage.accessible, true)
  assert.equal(health.storage.ready, false)
  assert.equal(health.storage.availabilityMessage, '')
  assert.match(health.storage.publicationMessage, /trusted operator/)
  assert.equal(health.storage.message, health.storage.publicationMessage)
  assert.deepEqual(getSupabaseCmsReadiness(health), {
    databaseReady: true,
    ready: true,
    storageReady: true,
    publishReady: false,
  })
  assert.deepEqual(
    client.storageCalls.filter(([operation]) => operation === 'list').map(([, bucket]) => bucket),
    [PRIVATE_BUCKET, PUBLIC_BUCKET],
  )
})

test('create sends validated draft content with initial optimistic revision', async () => {
  let savedArgs
  const client = mockClient(async (name, args) => {
    assert.equal(name, 'cms_save_record')
    savedArgs = args
    return {
      data: { id: 'project-1', ...args.p_payload, status: 'draft', revision: 1, publishedRevision: 0 },
      error: null,
    }
  })
  const api = createSupabaseCmsApi(client)
  const result = await api.create('projects', project())

  assert.equal(result.id, 'project-1')
  assert.equal(result.status, 'draft')
  assert.equal(savedArgs.p_id, null)
  assert.equal(savedArgs.p_expected_revision, 0)
  assert.equal(savedArgs.p_payload.slug, 'editorial-project')
})

test('save maps optimistic concurrency errors to a conflict state', async () => {
  const client = mockClient(async () => ({
    data: null,
    error: { code: '40001', message: 'This item changed in another session.' },
  }))
  const api = createSupabaseCmsApi(client)

  await assert.rejects(
    api.save('projects', 'project-1', project(), 4),
    (error) => error instanceof SupabaseCmsError && error.state === 'conflict' && error.status === 409,
  )
})

test('authorization failures from Supabase RLS are exposed as access errors', () => {
  const error = sanitizeSupabaseError({ code: '42501', message: 'row-level security violation' })
  assert.equal(error.state, 'auth')
  assert.equal(error.status, 401)
  assert.match(error.message, /not authorized/)
})

test('uploads use the trusted admin registry instead of a fixed administrator UID', async () => {
  const client = mockClient(async () => {
    throw new Error('CMS mutation should not be reached for a non-admin.')
  }, { isAdmin: false })
  const api = createSupabaseCmsApi(client)

  await assert.rejects(
    api.upload(imageFile()),
    (error) => error instanceof SupabaseCmsError && error.state === 'auth',
  )
  assert.equal(client.storageCalls.some(([operation]) => operation === 'upload'), false)
})

test('legacy bucket IDs remain distinct and the exact dotted ID is parsed', async () => {
  const bucketIds = ['portfolio-media.', 'portfolio-media', 'portfolio_media']
  assert.deepEqual(LEGACY_STORAGE_BUCKETS, bucketIds)
  assert.equal(new Set(LEGACY_STORAGE_BUCKETS).size, 3)

  const client = mockClient(async (name, args) => {
    assert.equal(name, 'cms_get_record')
    return {
      data: {
        id: args.p_id,
        ...project({
          heroImage: {
            url: '',
            storagePath: `${args.p_id}/projects/hero.png`,
            caption: '',
            order: 0,
          },
        }),
        status: 'draft',
      },
      error: null,
    }
  })
  const api = createSupabaseCmsApi(client)

  for (const bucketId of bucketIds) {
    await api.get('projects', bucketId)
  }

  assert.deepEqual(
    client.storageCalls.filter(([operation]) => operation === 'signed').map(([, bucket]) => bucket),
    bucketIds,
  )
})

test('publishing a private draft promotes assets and passes the current revision', async () => {
  const draft = project({
    heroImage: {
      url: 'https://signed.example/draft.png',
      storagePath: 'portfolio-private/drafts/admin/project-1/hero.png',
      caption: '',
      order: 0,
    },
  })
  let publishArgs
  const client = mockClient(async (name, args) => {
    if (name === 'cms_health') return { data: { storage: { ready: true } }, error: null }
    if (name === 'cms_get_record') {
      return {
        data: { id: 'project-1', ...draft, status: 'draft', revision: 3, publishedRevision: 2, basePublishedRevision: 2 },
        error: null,
      }
    }
    if (name === 'cms_publish_record') {
      publishArgs = args
      return {
        data: { id: 'project-1', ...args.p_payload, status: 'published', revision: 3, publishedRevision: 3 },
        error: null,
      }
    }
    if (name === 'cms_list_records') return { data: [], error: null }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const api = createSupabaseCmsApi(client)
  const result = await api.publish('projects', 'project-1', 3)

  assert.equal(publishArgs.p_expected_revision, 3)
  assert.equal(publishArgs.p_payload.heroImage.storagePath, 'portfolio-published/published/drafts/admin/project-1/hero.png')
  assert.equal(publishArgs.p_payload.heroImage.url, 'https://public.example/published/drafts/admin/project-1/hero.png')
  assert.equal(result.status, 'published')
  assert.ok(client.storageCalls.some(([operation, bucket]) => operation === 'upload' && bucket === PUBLIC_BUCKET))
  assert.ok(client.storageCalls.some(([operation, bucket]) => operation === 'download' && bucket === PRIVATE_BUCKET))
})

test('a completed asset promotion invalidates the next publish until Storage is reviewed again', async () => {
  let auditValid = true
  let publishCount = 0
  const client = mockClient(async (name, args) => {
    if (name === 'cms_health') {
      return { data: { storage: { ready: auditValid } }, error: null }
    }
    if (name === 'cms_get_record') {
      return {
        data: {
          id: 'media-repeat',
          ...imageMedia({
            storagePath: `${PRIVATE_BUCKET}/drafts/admin/media-repeat/image.png`,
            url: 'https://signed.example/draft-image',
          }),
          status: 'draft',
          revision: 1,
          publishedRevision: 0,
          basePublishedRevision: 0,
        },
        error: null,
      }
    }
    if (name === 'cms_publish_record') {
      publishCount += 1
      return {
        data: {
          id: args.p_id,
          ...args.p_payload,
          status: 'published',
          revision: 1,
          publishedRevision: 1,
        },
        error: null,
      }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const originalFrom = client.storage.from
  client.storage.from = (bucket) => {
    const storage = originalFrom(bucket)
    if (bucket === PUBLIC_BUCKET) {
      const upload = storage.upload
      storage.upload = async (...args) => {
        const result = await upload(...args)
        auditValid = false
        return result
      }
    }
    return storage
  }
  const api = createSupabaseCmsApi(client)

  const published = await api.publish('media', 'media-repeat', 1)
  assert.equal(published.status, 'published')
  assert.equal(auditValid, false)
  await assert.rejects(api.publish('media', 'media-repeat', 1), /Public bucket audit is required|storage has not been verified/i)
  assert.equal(publishCount, 1)
})

test('trusted Storage audit RPC sends the reviewed inventory but never a client user ID', async () => {
  const calls = []
  const snapshot = {
    bucket: { id: PUBLIC_BUCKET, name: PUBLIC_BUCKET, public: true },
    objects: [{ id: 'object-1', name: 'published/logo.png', referencedBy: [] }],
  }
  const client = mockClient(async (name, args) => {
    calls.push([name, args])
    if (name === 'cms_get_public_storage_audit_snapshot') {
      return { data: snapshot, error: null }
    }
    if (name === 'cms_record_public_storage_audit') {
      return { data: { bucketId: PUBLIC_BUCKET, auditedBy: 'server-user' }, error: null }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const api = createSupabaseCmsApi(client)
  const inventory = await api.getPublicStorageAuditSnapshot()
  assert.equal(inventory.snapshot, snapshot)
  assert.equal(inventory.objects[0].publicUrl, 'https://public.example/published/logo.png')

  await api.recordPublicStorageAudit(inventory.snapshot)
  assert.deepEqual(calls, [
    ['cms_get_public_storage_audit_snapshot', {}],
    ['cms_record_public_storage_audit', { p_reviewed_snapshot: snapshot }],
  ])
  assert.equal(Object.keys(calls[1][1]).includes('p_user_id'), false)
})

test('Storage audit RPC authorization failures are surfaced from the server', async () => {
  const client = mockClient(async () => ({
    data: null,
    error: { code: '42501', message: 'not an authorized portfolio administrator' },
  }))
  const api = createSupabaseCmsApi(client)

  await assert.rejects(
    api.getPublicStorageAuditSnapshot(),
    (error) => error instanceof SupabaseCmsError && error.state === 'auth',
  )
})

test('new media uploads remain private drafts until explicit publication', async () => {
  const events = []
  const client = mockClient(async (name, args) => {
    events.push(['rpc', name])
    if (name === 'cms_save_record') {
      return { data: { id: args.p_id, ...args.p_payload, status: 'draft', revision: 1 }, error: null }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const api = createSupabaseCmsApi(client)
  const result = await api.upload(imageFile())

  assert.ok(client.storageCalls.some(([operation, bucket]) => operation === 'upload' && bucket === PRIVATE_BUCKET))
  assert.equal(result.status, 'draft')
  assert.equal(events.some(([, name]) => name === 'cms_publish_record'), false)
  assert.equal(client.storageCalls.some(([operation]) => operation === 'copy'), false)
})

test('resume files remain private drafts and are not auto-published on upload', async () => {
  const calls = []
  const client = mockClient(async (name, args) => {
    calls.push(name)
    if (name === 'cms_list_records') return { data: [], error: null }
    if (name === 'cms_save_record') {
      return { data: { id: 'resume-new', ...args.p_payload, status: 'draft', revision: 1 }, error: null }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const api = createSupabaseCmsApi(client)
  await api.upload(validPdfFile(), { kind: 'resume' })

  assert.ok(client.storageCalls.some(([operation, bucket]) => operation === 'upload' && bucket === PRIVATE_BUCKET))
  assert.equal(client.storageCalls.some(([operation]) => operation === 'copy'), false)
  assert.equal(calls.includes('cms_publish_record'), false)
})

test('a failed publish does not copy a private draft into public storage', async () => {
  const client = mockClient(async (name) => {
    if (name === 'cms_health') return { data: { storage: { ready: true } }, error: null }
    if (name === 'cms_get_record') {
      return {
        data: {
          id: 'project-1',
          ...project({ heroImage: { url: 'https://signed.example/draft', storagePath: 'portfolio-private/drafts/admin/hero.png', caption: '', order: 0 } }),
          status: 'draft',
          revision: 2,
          publishedRevision: 1,
          basePublishedRevision: 1,
        },
        error: null,
      }
    }
    if (name === 'cms_publish_record') return { data: null, error: { code: '40001', message: 'Revision conflict.' } }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const api = createSupabaseCmsApi(client)

  await assert.rejects(api.publish('projects', 'project-1', 2), /Revision conflict/)
  assert.equal(client.storageCalls.some(([operation]) => operation === 'copy'), false)
})

test('a failed asset copy withdraws publication and retains the private source', async () => {
  const rpcCalls = []
  const client = mockClient(async (name, args) => {
    rpcCalls.push(name)
    if (name === 'cms_health') return { data: { storage: { ready: true } }, error: null }
    if (name === 'cms_get_record') {
      return {
        data: {
          id: 'project-1',
          ...project({ heroImage: { url: 'https://signed.example/draft', storagePath: 'portfolio-private/drafts/admin/hero.png', caption: '', order: 0 } }),
          status: 'draft',
          revision: 1,
          publishedRevision: 0,
          basePublishedRevision: 0,
        },
        error: null,
      }
    }
    if (name === 'cms_publish_record') {
      return { data: { id: args.p_id, ...args.p_payload, status: 'published', revision: 1 }, error: null }
    }
    if (name === 'cms_unpublish_record') return { data: { id: args.p_id, status: 'unpublished' }, error: null }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const originalFrom = client.storage.from
  client.storage.from = (bucket) => {
    const storage = originalFrom(bucket)
    if (bucket === 'portfolio-private') {
      storage.download = async () => ({ data: null, error: { message: 'download unavailable' } })
    }
    return storage
  }
  const api = createSupabaseCmsApi(client)

  await assert.rejects(api.publish('projects', 'project-1', 1), /Publishing was rolled back/)
  assert.deepEqual(rpcCalls, ['cms_get_record', 'cms_health', 'cms_publish_record', 'cms_unpublish_record'])
  assert.equal(client.storageCalls.some(([operation, bucket]) => operation === 'remove' && bucket === PRIVATE_BUCKET), false)
})

test('a failed rollback after asset-copy failure reports the possibly published record and retains private source', async () => {
  let downloadCount = 0
  const client = mockClient(async (name, args) => {
    if (name === 'cms_health') return { data: { storage: { ready: true } }, error: null }
    if (name === 'cms_get_record') {
      return {
        data: {
          id: 'project-rollback-failure',
          ...project({
            heroImage: { url: 'https://signed.example/draft', storagePath: 'portfolio-private/drafts/admin/hero.png', caption: '', order: 0 },
            gallery: [{ url: 'https://signed.example/draft-2', storagePath: 'portfolio-private/drafts/admin/gallery.png', caption: '', order: 0 }],
          }),
          status: 'draft',
          revision: 1,
          publishedRevision: 0,
          basePublishedRevision: 0,
        },
        error: null,
      }
    }
    if (name === 'cms_publish_record') {
      return { data: { id: args.p_id, ...args.p_payload, status: 'published', revision: 1 }, error: null }
    }
    if (name === 'cms_unpublish_record') {
      return { data: null, error: { code: '55000', message: 'Storage readiness changed.' } }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const originalFrom = client.storage.from
  client.storage.from = (bucket) => {
    const storage = originalFrom(bucket)
    if (bucket === PRIVATE_BUCKET) {
      storage.download = async (path) => {
        client.storageCalls.push(['download', bucket, path])
        downloadCount += 1
        return downloadCount === 1
          ? { data: { type: 'image/png' }, error: null }
          : { data: null, error: { message: 'download unavailable' } }
      }
    }
    return storage
  }
  const api = createSupabaseCmsApi(client)

  await assert.rejects(
    api.publish('projects', 'project-rollback-failure', 1),
    (error) => error instanceof SupabaseCmsError
      && error.state === 'serverError'
      && /record was published but its assets could not be copied/.test(error.message)
      && /Successfully copied staged assets were removed/.test(error.message)
      && /original uploads remain private/.test(error.message),
  )
  assert.ok(client.storageCalls.some(([operation, bucket]) => operation === 'remove' && bucket === PUBLIC_BUCKET))
  assert.equal(client.storageCalls.some(([operation, bucket]) => operation === 'remove' && bucket === PRIVATE_BUCKET), false)
})

test('unverified public storage blocks publication without moving private assets', async () => {
  const rpcCalls = []
  const client = mockClient(async (name) => {
    rpcCalls.push(name)
    if (name === 'cms_get_record') {
      return {
        data: {
          id: 'project-1',
          ...project({ heroImage: { url: 'https://signed.example/draft', storagePath: 'portfolio-private/drafts/admin/hero.png', caption: '', order: 0 } }),
          status: 'draft',
          revision: 1,
          publishedRevision: 0,
          basePublishedRevision: 0,
        },
        error: null,
      }
    }
    if (name === 'cms_health') {
      return { data: { storage: { ready: false, message: 'Public bucket audit is required.' } }, error: null }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const api = createSupabaseCmsApi(client)

  await assert.rejects(api.publish('projects', 'project-1', 1), /Public bucket audit is required/)
  assert.deepEqual(rpcCalls, ['cms_get_record', 'cms_health'])
  assert.equal(client.storageCalls.some(([operation]) => operation === 'copy'), false)
})

test('private legacy portfolio_media paths are only promoted during explicit publish', async () => {
  const client = mockClient(async (name, args) => {
    if (name === 'cms_health') return { data: { storage: { ready: true } }, error: null }
    if (name === 'cms_get_record') {
      return {
        data: {
          id: 'project-legacy',
          ...project({ heroImage: { url: 'https://signed.example/legacy', storagePath: 'portfolio_media/projects/hero.png', caption: '', order: 0 } }),
          status: 'draft',
          revision: 2,
          publishedRevision: 0,
          basePublishedRevision: 0,
        },
        error: null,
      }
    }
    if (name === 'cms_publish_record') {
      return { data: { id: args.p_id, ...args.p_payload, status: 'published', revision: 2 }, error: null }
    }
    if (name === 'cms_list_records') return { data: [], error: null }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const api = createSupabaseCmsApi(client)
  const result = await api.publish('projects', 'project-legacy', 2)

  assert.equal(result.heroImage.storagePath, `${PUBLIC_BUCKET}/published/projects/hero.png`)
  assert.ok(client.storageCalls.some(([operation, bucket]) => operation === 'download' && bucket === 'portfolio_media'))
  assert.equal(client.storageCalls.some(([operation, bucket]) => operation === 'remove' && bucket === 'portfolio_media'), false)
})

test('a failed media publish keeps the saved draft and uploaded file intact', async () => {
  const client = mockClient(async (name, args) => {
    if (name === 'cms_save_record') {
      return { data: { id: 'media-1', ...args.p_payload, status: 'draft', revision: 1 }, error: null }
    }
    if (name === 'cms_get_record') {
      return {
        data: {
          id: 'media-1',
          ...imageMedia({
            storagePath: `${PRIVATE_BUCKET}/drafts/admin/media-1/image.png`,
            url: 'https://signed.example/draft-image',
          }),
          status: 'draft',
          revision: 1,
          publishedRevision: 0,
          basePublishedRevision: 0,
        },
        error: null,
      }
    }
    if (name === 'cms_health') return { data: { storage: { ready: true } }, error: null }
    if (name === 'cms_publish_record') {
      return { data: null, error: { code: '40001', message: 'A newer revision exists.' } }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const api = createSupabaseCmsApi(client)
  await api.upload(imageFile())

  await assert.rejects(
    api.publish('media', 'media-1', 1),
    (error) => error instanceof SupabaseCmsError && error.state === 'conflict',
  )
  assert.ok(client.storageCalls.some(([operation]) => operation === 'upload'))
  assert.equal(client.storageCalls.some(([operation]) => operation === 'copy'), false)
})

function imageMedia(overrides = {}) {
  return {
    url: 'https://public.example/published/media-1.png',
    storagePath: `${PUBLIC_BUCKET}/published/media-1.png`,
    type: 'image',
    sizeBytes: 8,
    fileName: 'preview.png',
    mimeType: 'image/png',
    alt: '',
    sourceUrl: '',
    usedIn: [],
    visibility: true,
    order: 0,
    ...overrides,
  }
}

test('migration is conservative for ambiguous legacy records and preserves projection rows', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261028130000_portfolio_cms.sql', import.meta.url),
    'utf8',
  )
  const migrationStart = migration.indexOf('$migration$;')
  const projectionBootstrap = migration.slice(
    migration.indexOf('insert into public.portfolio_cms_public_records (content_type, record_id, published_payload)', migrationStart),
    migration.indexOf('insert into storage.buckets', migrationStart),
  )
  const recordTriggerCreate = migration.indexOf('create trigger portfolio_cms_public_record_sync')
  const settingsTriggerCreate = migration.indexOf('create trigger portfolio_cms_public_settings_sync')
  const publishedBucketSetup = migration.slice(
    migration.indexOf("values ('portfolio-published', 'portfolio-published'"),
    migration.indexOf('drop policy if exists portfolio_private_admin_select'),
  )
  const privateBucketSetup = migration.slice(
    migration.indexOf("values ('portfolio-private', 'portfolio-private'"),
    migration.indexOf("values ('portfolio-published', 'portfolio-published'"),
  )

  assert.match(migration, /values \('portfolio-private', 'portfolio-private', false,[\s\S]*?on conflict \(id\) do update set\s+file_size_limit = excluded\.file_size_limit/)
  assert.doesNotMatch(privateBucketSetup, /public\s*=/i)
  assert.match(migration, /values \('portfolio-published', 'portfolio-published', false,/)
  assert.match(migration, /on conflict \(id\) do update set\s+file_size_limit = excluded\.file_size_limit/)
  assert.doesNotMatch(publishedBucketSetup, /public\s*=/i)
  assert.doesNotMatch(migration, /values \('portfolio_media',/)
  assert.ok(migration.includes("position('/' || p_bucket || '/' in v_text) > 0"))
  assert.match(migration, /create or replace function public\.cms_jsonb_uses_storage_bucket\(p_value jsonb, p_bucket text\)/)
  assert.match(migration, /create or replace function public\.cms_jsonb_has_unknown_storage_bucket\(p_value jsonb\)/)
  assert.match(migration, /add column if not exists visibility_verified_at timestamptz/)
  assert.match(migration, /ordinary CMS users have no write access/)
  assert.match(migration, /v_state is null then[\s\S]{0,180}then 'published'[\s\S]{0,80}else 'draft'/)
  assert.match(migration, /v_state is null then v_state := 'draft'/)
  assert.match(migration, /v_draft_payload := v_draft_payload \|\| '\{"visibility":false\}'::jsonb/)
  assert.match(migration, /jsonb_typeof\(v_draft_payload -> 'techStack'\) = 'string'/)
  assert.match(migration, /string_to_array\(v_draft_payload ->> 'techStack', ','\)/)
  assert.match(migration, /v_draft_payload -> 'technologies'[\s\S]{0,100}jsonb_set\(v_draft_payload, '\{techStack\}', v_draft_payload -> 'technologies'/)
  assert.match(migration, /v_draft_payload -> 'description'[\s\S]{0,120}jsonb_set\(v_draft_payload, '\{synopsis\}'/)
  assert.match(migration, /v_draft_payload -> 'cover_image'/)
  assert.match(migration, /v_draft_payload -> 'images'/)
  assert.match(projectionBootstrap, /on conflict \(content_type, record_id\) do nothing;/)
  assert.match(projectionBootstrap, /on conflict \(id\) do nothing;/)
  assert.doesNotMatch(projectionBootstrap, /do update|delete from public\.portfolio_cms_public_/i)
  assert.ok(recordTriggerCreate > migration.indexOf('on conflict (id) do nothing;', migration.indexOf('insert into public.portfolio_cms_public_settings', migrationStart)))
  assert.ok(settingsTriggerCreate > recordTriggerCreate)
  assert.doesNotMatch(migration.slice(migrationStart, recordTriggerCreate), /create trigger portfolio_cms_public_(record|settings)_sync/)
  assert.match(migration.trim(), /commit;$/i)
})

test('migration distinguishes every legacy bucket and checks the exact dotted bucket contents and references', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261028130000_portfolio_cms.sql', import.meta.url),
    'utf8',
  )
  const legacySafety = migration.slice(
    migration.indexOf('create or replace function public.cms_jsonb_uses_storage_bucket'),
    migration.indexOf('create or replace function public.cms_require_portfolio_admin'),
  )
  const publicationReadiness = migration.slice(
    migration.indexOf('create or replace function public.cms_publication_block_reason'),
    migration.indexOf('create or replace function public.cms_is_admin'),
  )

  for (const bucket of ['portfolio_media', 'portfolio-media', 'portfolio-media.']) {
    assert.ok(legacySafety.includes(`'${bucket}'`))
    assert.ok(publicationReadiness.includes(`cms_legacy_bucket_safe('${bucket}'`))
  }
  assert.match(legacySafety, /where o\.bucket_id = p_bucket/)
  assert.match(legacySafety, /cms_jsonb_uses_storage_bucket\(coalesce\(r\.draft_payload, '\{\}'::jsonb\), p_bucket\)/)
  assert.ok(legacySafety.includes("left(v_text, char_length(p_bucket) + 1) = p_bucket || '/'"))
  assert.doesNotMatch(legacySafety, /like p_bucket/i)
  assert.match(legacySafety, /from public\.portfolio_cms_public_records r/)
  assert.match(legacySafety, /from public\.portfolio_cms_public_settings s/)
  assert.match(publicationReadiness, /legacy portfolio_media bucket is missing or public/)
  assert.match(legacySafety, /if not v_public then return true|return not v_public or \(v_empty and not v_referenced\)/)
  assert.match(publicationReadiness, /portfolio-published bucket must be explicitly configured as public/)
  assert.match(publicationReadiness, /visibility_verified_at/)
  assert.match(publicationReadiness, /audited_at/)
  assert.doesNotMatch(publicationReadiness, /projections_audited_at/)
  assert.doesNotMatch(migration, /values \('portfolio-media\.?'/)
  assert.match(migration, /bucket_id not in \('portfolio_media', 'portfolio-media', 'portfolio-media\.'\)/)
  const healthFunction = migration.slice(
    migration.indexOf('create or replace function public.cms_health'),
    migration.indexOf('create or replace function public.cms_record_json'),
  )
  assert.match(healthFunction, /v_message := public\.cms_publication_block_reason\(\)/)
  assert.match(healthFunction, /'ready', v_media_public[\s\S]*?v_message = ''/)
  assert.match(healthFunction, /'publicStorageContentAuditRecorded', v_media_audited/)
  assert.match(healthFunction, /'publicProjectionEligible', public\.cms_public_content_audited\(\)/)
})

test('database publish RPCs enforce admin, storage readiness, asset eligibility, and public projection gates', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261028130000_portfolio_cms.sql', import.meta.url),
    'utf8',
  )
  const functionBody = (name, nextName) => migration.slice(
    migration.indexOf(`create or replace function public.${name}`),
    migration.indexOf(`create or replace function public.${nextName}`),
  )
  const publishRecord = functionBody('cms_publish_record', 'cms_unpublish_record')
  const publishSettings = functionBody('cms_publish_settings', 'cms_unpublish_settings')
  const projectionRead = migration.slice(
    migration.indexOf('create policy portfolio_cms_public_projection_read'),
    migration.indexOf('create policy portfolio_cms_public_settings_projection_read'),
  )
  const settingsProjectionRead = migration.slice(
    migration.indexOf('create policy portfolio_cms_public_settings_projection_read'),
    migration.indexOf('create or replace function public.cms_sync_public_record'),
  )

  for (const publishFunction of [publishRecord, publishSettings]) {
    assert.match(publishFunction, /cms_require_portfolio_admin\(\)/)
    assert.match(publishFunction, /cms_publication_block_reason\(\)/)
    assert.match(publishFunction, /errcode = '55000'/)
  }
  assert.match(publishRecord, /cms_jsonb_has_unknown_storage_bucket\(v_payload\)/)
  assert.match(publishSettings, /cms_jsonb_has_unknown_storage_bucket\(v_current\.draft_payload\)/)
  assert.match(publishRecord, /v_current\.revision <> p_expected_revision/)
  assert.match(publishSettings, /v_current\.revision <> p_expected_revision/)
  for (const bucket of ['portfolio-private', 'portfolio_media', 'portfolio-media', 'portfolio-media.']) {
    assert.ok(publishRecord.includes(`cms_jsonb_uses_storage_bucket(v_payload, '${bucket}')`))
    assert.ok(publishSettings.includes(`cms_jsonb_uses_storage_bucket(v_current.draft_payload, '${bucket}')`))
  }
  assert.match(projectionRead, /published_payload ->> 'visibility' = 'true' and public\.cms_public_content_audited\(\)/)
  assert.match(settingsProjectionRead, /published_payload ->> 'visibility' = 'true' and public\.cms_public_content_audited\(\)/)
  const projectionEligibility = migration.slice(
    migration.indexOf('create or replace function public.cms_public_content_audited'),
    migration.indexOf('create index if not exists portfolio_cms_records_public_type_idx'),
  )
  assert.match(projectionEligibility, /projection\.published_payload is distinct from source\.published_payload/)
  assert.match(projectionEligibility, /cms_jsonb_has_unknown_storage_bucket/)
  assert.match(projectionEligibility, /cms_jsonb_uses_storage_bucket\(source\.published_payload, 'portfolio-private'\)/)
  assert.doesNotMatch(projectionEligibility, /audited_at|visibility_verified_at|projections_audited_at/)
  assert.match(migration, /create policy portfolio_cms_admin_records_read[\s\S]*?using \(public\.is_portfolio_admin\(\)\)/)
  assert.match(migration, /create policy portfolio_private_anon_block[\s\S]*?using \(bucket_id <> 'portfolio-private'\)/)
  assert.match(migration, /create policy portfolio_private_authenticated_guard[\s\S]*?public\.cms_is_admin\(\)/)
  assert.match(migration, /revoke all on public\.portfolio_cms_storage_audit from public, anon, authenticated/)
  assert.match(migration, /ordinary authenticated users have no write access/i)
  assert.match(migration, /set projections_audited_at = null\s+where bucket_id = 'portfolio-published'/)
  assert.match(migration, /and not exists \([\s\S]*from public\.portfolio_cms_public_records projection[\s\S]*source\.published_payload is distinct from projection\.published_payload/)
  assert.match(migration, /create trigger portfolio_cms_storage_object_audit_invalidation/)
  assert.match(migration, /create trigger portfolio_cms_storage_bucket_audit_invalidation/)
  assert.match(migration, /create trigger portfolio_cms_public_record_audit_invalidation/)
  assert.match(migration, /after insert or update or delete on public\.portfolio_cms_records/)
  assert.doesNotMatch(migration, /350db73c-d045-4b51-88bf-36ee9b2d07db/)
  assert.match(migration, /public\.is_portfolio_admin\(\)/)
  assert.match(migration, /revoke all on function public\.cms_publication_block_reason\(\) from public, anon, authenticated/)
  assert.match(migration, /revoke all on function public\.cms_legacy_bucket_safe\(text, boolean\) from public, anon, authenticated/)
})

test('public lifecycle validation covers publish, unpublish, delete, stale parity, and audit invalidation', async () => {
  const sql = await readFile(
    new URL('../supabase/validation/06_public_lifecycle.sql', import.meta.url),
    'utf8',
  )
  assert.match(sql, /ifakxmugmdcjyhytzpwx/)
  assert.match(sql, /cms_publish_record/)
  assert.match(sql, /cms_unpublish_record/)
  assert.match(sql, /cms_delete_record/)
  assert.match(sql, /anonymous_after_publish/)
  assert.match(sql, /anonymous_after_unpublish/)
  assert.match(sql, /anonymous_after_delete/)
  assert.match(sql, /anonymous_stale_projection/)
  assert.match(sql, /anonymous_after_audit_invalidation/)
  assert.match(sql, /audit_invalidated_publish_gate/)
  assert.match(sql, /cms_publication_block_reason/)
  assert.match(sql, /rerun_sentinel_preflight/)
  assert.match(sql, /delete from public\.portfolio_cms_public_records[\s\S]*validation-rerun-sentinel/)
  assert.match(sql, /portfolio-legacy-published|validation-legacy-published/)
  assert.match(sql.trim(), /rollback;$/i)
})

test('Storage changes invalidate publication attestations without coupling them to public reads', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261028130000_portfolio_cms.sql', import.meta.url),
    'utf8',
  )
  const auditInvalidation = migration.slice(
    migration.indexOf('create or replace function public.cms_invalidate_storage_audit'),
    migration.indexOf('create trigger portfolio_cms_storage_bucket_audit_invalidation'),
  )
  assert.match(auditInvalidation, /set audited_at = null/)
  assert.match(auditInvalidation, /set visibility_verified_at = null, audited_at = null/)
  assert.match(migration, /after insert or update or delete on storage\.objects/)
  assert.match(migration, /after insert or update or delete on storage\.buckets/)
  assert.match(migration, /create or replace function public\.cms_public_content_audited/)
  assert.doesNotMatch(
    migration.slice(
      migration.indexOf('create or replace function public.cms_public_content_audited'),
      migration.indexOf('create index if not exists portfolio_cms_records_public_type_idx'),
    ),
    /audited_at|visibility_verified_at|projections_audited_at/,
  )
})

test('Storage review workflow is admin-gated, identity-derived, and snapshot-bound', async () => {
  const baseMigration = await readFile(
    new URL('../supabase/migrations/20261028130000_portfolio_cms.sql', import.meta.url),
    'utf8',
  )
  const migration = await readFile(
    new URL('../supabase/migrations/20261029120000_portfolio_storage_audit_workflow.sql', import.meta.url),
    'utf8',
  )
  const snapshot = migration.slice(
    migration.indexOf('create or replace function public.cms_public_storage_audit_snapshot'),
    migration.indexOf('create or replace function public.cms_get_public_storage_audit_snapshot'),
  )
  const recordAudit = migration.slice(
    migration.indexOf('create or replace function public.cms_record_public_storage_audit'),
    migration.indexOf('revoke all on function public.cms_public_storage_audit_snapshot()'),
  )

  assert.match(snapshot, /portfolio-published/)
  assert.match(snapshot, /portfolio-private/)
  assert.match(snapshot, /cms_legacy_bucket_safe/)
  assert.match(snapshot, /cms_public_content_audited/)
  assert.match(snapshot, /'referencedBy'/)
  assert.match(snapshot, /'metadata'/)
  assert.match(snapshot, /cms_jsonb_uses_storage_path\(/)
  assert.match(baseMigration, /p_value ->> 'storagePath' = p_path/)
  assert.doesNotMatch(migration, /create or replace function public\.cms_jsonb_uses_storage_path/)
  assert.match(recordAudit, /cms_require_portfolio_admin\(\)/)
  assert.match(recordAudit, /p_reviewed_snapshot is distinct from v_current_snapshot/)
  assert.match(recordAudit, /audited_by = v_uid/)
  assert.match(recordAudit, /v_uid uuid := public\.cms_require_portfolio_admin\(\)/)
  assert.doesNotMatch(recordAudit, /p_user_id|p_audited_by/)
  assert.match(migration, /revoke all on function public\.cms_get_public_storage_audit_snapshot\(\)[\s\S]*from public, anon, authenticated/)
  assert.match(migration, /grant execute on function public\.cms_get_public_storage_audit_snapshot\(\)\s+to authenticated/)
  assert.match(migration, /grant execute on function public\.cms_record_public_storage_audit\(jsonb\)\s+to authenticated/)
  assert.doesNotMatch(migration, /drop trigger|alter table storage\.objects|update storage\.buckets/i)
})

test('Storage audit SQL validation preserves the shared helper contract and tests real roles', async () => {
  const validation = await readFile(
    new URL('../supabase/validation/07_storage_audit_workflow.sql', import.meta.url),
    'utf8',
  )
  const requestedPath = await readFile(
    new URL('../supabase/tests/07_storage_audit_workflow.sql', import.meta.url),
    'utf8',
  )
  assert.equal(requestedPath, validation)
  assert.match(validation, /shared_helper_contract/)
  assert.match(validation, /plain JSON string was misidentified/)
  assert.match(validation, /actual storagePath property/)
  assert.match(validation, /set local role anon/)
  assert.match(validation, /set local role authenticated/)
  assert.match(validation, /has_function_privilege/)
  assert.match(validation, /has_table_privilege/)
  assert.match(validation, /authenticated_non_admin_denied/)
  assert.match(validation.trim(), /rollback;$/i)
})

test('Storage audit hosted scenarios cover operator identity, stale snapshots, and authorization', async () => {
  const sql = await readFile(
    new URL('../supabase/tests/07_storage_audit_workflow.integration.mjs', import.meta.url),
    'utf8',
  )
  assert.match(sql, /ifakxmugmdcjyhytzpwx\.supabase\.co/)
  assert.match(sql, /SUPABASE_TEST_ADMIN_EMAIL/)
  assert.match(sql, /SUPABASE_TEST_NON_ADMIN_EMAIL/)
  assert.match(sql, /signInWithPassword/)
  assert.match(sql, /auth\.getUser/)
  assert.match(sql, /error\.code, '42501'/)
  assert.match(sql, /publicStorageContentAuditRecorded/)
  assert.match(sql, /finally/)
  assert.match(sql, /cms_get_public_storage_audit_snapshot/)
  assert.match(sql, /cms_record_public_storage_audit/)
  assert.match(sql, /auditedBy, userData\.user\.id/)
})
