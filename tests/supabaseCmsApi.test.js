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
import { getAdminRecoveryRedirectUrl } from '../src/lib/siteUrls.js'
import { projectSchema } from '../src/lib/db/contentSchemas.js'

test('password recovery redirect prefers explicit and configured public app URLs', () => {
  assert.equal(getAdminRecoveryRedirectUrl({
    configuredRedirectUrl: 'https://portfolio.example/admin/reset-password',
    publicSiteUrl: 'https://other.example',
    origin: 'http://localhost:3000',
  }), 'https://portfolio.example/admin/reset-password')

  assert.equal(getAdminRecoveryRedirectUrl({
    publicSiteUrl: 'https://portfolio.example/',
    origin: 'http://localhost:3000',
  }), 'https://portfolio.example/admin/reset-password')

  assert.equal(getAdminRecoveryRedirectUrl({
    configuredRedirectUrl: 'http://localhost:3000/admin/reset-password',
    origin: 'http://localhost:3000',
  }), 'http://localhost:3000/admin/reset-password')

  assert.equal(getAdminRecoveryRedirectUrl({
    origin: 'https://portfolio.example',
  }), 'https://portfolio.example/admin/reset-password')

  assert.throws(() => getAdminRecoveryRedirectUrl({
    origin: 'https://portfolio.example',
    isProduction: true,
  }), /VITE_ADMIN_RECOVERY_REDIRECT_URL must be configured for production/)

  assert.throws(() => getAdminRecoveryRedirectUrl({
    configuredRedirectUrl: 'http://localhost:3000/admin/reset-password',
    origin: 'https://portfolio.example',
    isProduction: true,
  }), /Production password recovery cannot redirect to localhost/)
})

test('password recovery redirect rejects invalid configured URLs', () => {
  assert.throws(() => getAdminRecoveryRedirectUrl({
    configuredRedirectUrl: 'javascript:alert(1)',
    origin: 'http://localhost:3000',
  }), /must use HTTP or HTTPS/)

  assert.throws(() => getAdminRecoveryRedirectUrl({
    configuredRedirectUrl: 'https://portfolio.example/',
    origin: 'http://localhost:3000',
  }), /must end in \/admin\/reset-password/)

  assert.throws(() => getAdminRecoveryRedirectUrl({
    origin: 'http://localhost:3000',
  }), /Set VITE_ADMIN_RECOVERY_REDIRECT_URL or VITE_PUBLIC_PORTFOLIO_URL/)
})

function project(overrides = {}) {
  return projectSchema.parse({
    title: 'Editorial project',
    slug: 'editorial-project',
    category: 'Web',
    ...overrides,
  })
}

function mockClient(rpc, {
  isAdmin = true,
  userId = '11111111-1111-4111-8111-111111111111',
  signingErrors = new Map(),
} = {}) {
  const storageCalls = []
  const projectionCalls = []
  let publishedSettings = null
  const storage = {
    from(bucket) {
      return {
        async createSignedUrl(path) {
          storageCalls.push(['signed', bucket, path])
          const error = signingErrors.get(`${bucket}/${path}`)
          if (error) return { data: null, error }
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
    projectionCalls,
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
    from(table) {
      const query = {
        select(columns) {
          projectionCalls.push(['select', table, columns])
          return query
        },
        eq(column, value) {
          projectionCalls.push(['eq', table, column, value])
          return query
        },
        async maybeSingle() {
          projectionCalls.push(['maybeSingle', table])
          return {
            data: table === 'portfolio_cms_public_settings' && publishedSettings
              ? { published_payload: publishedSettings }
              : null,
            error: null,
          }
        },
      }
      return query
    },
    rpc: async (name, args) => {
      if (name === 'cms_is_admin') return { data: isAdmin, error: null }
      const result = await rpc(name, args)
      if (name === 'cms_publish_settings_with_assets' && !result.error) {
        publishedSettings = result.data
          ? Object.fromEntries(Object.entries(result.data).filter(([key]) => ![
            'id', 'status', 'revision', 'publishedRevision', 'basePublishedRevision',
            'createdAt', 'updatedAt', 'publishedAt', 'publishedBy', 'updatedBy',
          ].includes(key)))
          : null
      }
      return result
    },
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

test('missing project images do not break dashboard record loading and are reported by record', async () => {
  const missingPath = `${PRIVATE_BUCKET}/drafts/admin/shared/cover.png`
  const client = mockClient(async (name, args) => {
    assert.equal(name, 'cms_list_records')
    assert.equal(args.p_type, 'projects')
    return {
      data: [
        {
          id: 'project-missing-a',
          ...project({ heroImage: { storagePath: missingPath, url: 'https://example.test/old-cover.png' } }),
          status: 'draft',
          revision: 1,
        },
        {
          id: 'project-missing-b',
          ...project({ title: 'Second project', heroImage: { storagePath: missingPath, url: 'https://example.test/old-cover.png' } }),
          status: 'draft',
          revision: 1,
        },
        {
          id: 'project-valid',
          ...project({ title: 'Valid project', heroImage: { storagePath: `${PRIVATE_BUCKET}/drafts/admin/valid/cover.png` } }),
          status: 'draft',
          revision: 1,
        },
      ],
      error: null,
    }
  }, {
    signingErrors: new Map([[missingPath, { statusCode: '404', message: 'Object not found' }]]),
  })
  const api = createSupabaseCmsApi(client)
  const records = await api.list('projects', 'drafts')

  assert.equal(records.length, 3)
  assert.equal(records[0].heroImage.storagePath, missingPath)
  assert.equal(records[0].heroImage.url, '')
  assert.equal(records[2].heroImage.url, 'https://signed.example/drafts/admin/valid/cover.png')
  assert.equal(client.storageCalls.filter(([op, bucket, path]) =>
    op === 'signed' && bucket === PRIVATE_BUCKET && path === 'drafts/admin/shared/cover.png',
  ).length, 1, 'same missing object should be signed only once during this collection load')
  assert.deepEqual(
    api.getStorageAssetDiagnostics()
      .filter((item) => item.objectPath === 'drafts/admin/shared/cover.png')
      .map(({ recordType, recordId, field, bucket, status, recommendedAction }) => ({
        recordType, recordId, field, bucket, status, recommendedAction,
      })),
    [
      {
        recordType: 'projects',
        recordId: 'project-missing-a',
        field: 'heroImage.storagePath',
        bucket: PRIVATE_BUCKET,
        status: 'missing',
        recommendedAction: 'Replace or re-upload this asset.',
      },
      {
        recordType: 'projects',
        recordId: 'project-missing-b',
        field: 'heroImage.storagePath',
        bucket: PRIVATE_BUCKET,
        status: 'missing',
        recommendedAction: 'Replace or re-upload this asset.',
      },
    ],
  )
})

test('missing resume assets preserve resume records while exposing a diagnostic', async () => {
  const storagePath = `${PRIVATE_BUCKET}/drafts/admin/resume/file.pdf`
  const client = mockClient(async () => ({
    data: [{
      id: 'resume-missing',
      fileName: 'resume.pdf',
      fileUrl: 'expired-url',
      previewUrl: 'expired-preview',
      storagePath,
      status: 'published',
      revision: 3,
      visibility: true,
    }],
    error: null,
  }), {
    signingErrors: new Map([[storagePath, { statusCode: '404', message: 'Object not found' }]]),
  })
  const api = createSupabaseCmsApi(client)
  const [resume] = await api.list('resumes', 'published')

  assert.equal(resume.id, 'resume-missing')
  assert.equal(resume.fileName, 'resume.pdf')
  assert.equal(resume.storagePath, storagePath)
  assert.equal(resume.fileUrl, '')
  assert.equal(resume.previewUrl, '')
  assert.equal(api.getStorageAssetDiagnostics()[0].recordType, 'resumes')
  assert.equal(api.getStorageAssetDiagnostics()[0].status, 'missing')
})

test('Storage diagnostics distinguish access denial, expired auth, network and other errors', async () => {
  const assets = [
    ['denied', { status: 403, message: 'Unauthorized' }, 'access-denied'],
    ['unauthenticated', { status: 401, message: 'Unauthorized' }, 'access-denied'],
    ['expired', { status: 401, message: 'JWT expired' }, 'expired-auth'],
    ['offline', new TypeError('Failed to fetch'), 'network-error'],
    ['other', { status: 500, message: 'Storage internal error' }, 'storage-error'],
  ]
  const signingErrors = new Map(assets.map(([name, error]) => [
    `${PRIVATE_BUCKET}/drafts/${name}.png`,
    error,
  ]))
  const client = mockClient(async () => ({
    data: assets.map(([name]) => ({
      id: `project-${name}`,
      ...project({ title: name, heroImage: { storagePath: `${PRIVATE_BUCKET}/drafts/${name}.png`, url: 'https://example.test/stale.png' } }),
      status: 'draft',
    })),
    error: null,
  }), { signingErrors })
  const api = createSupabaseCmsApi(client)
  const records = await api.list('projects', 'drafts')

  assert.equal(records.length, assets.length)
  assert.ok(records.every((record) => record.heroImage.url === '' && record.heroImage.storagePath))
  assert.deepEqual(
    api.getStorageAssetDiagnostics().map((item) => item.status).sort(),
    assets.map(([, , status]) => status).sort(),
  )
})

test('failed asset diagnostics can be retried after an object is restored', async () => {
  const storagePath = `${PRIVATE_BUCKET}/drafts/admin/restored.png`
  const signingErrors = new Map([[storagePath, { statusCode: '404', message: 'Object not found' }]])
  const client = mockClient(async () => ({
    data: [{
      id: 'project-restored',
      ...project({ heroImage: { storagePath } }),
      status: 'draft',
    }],
    error: null,
  }), { signingErrors })
  const api = createSupabaseCmsApi(client)

  await api.list('projects', 'drafts')
  assert.equal(api.getStorageAssetDiagnostics()[0].status, 'missing')
  signingErrors.delete(storagePath)
  api.retryStorageAssetChecks()
  const [restored] = await api.list('projects', 'drafts')
  assert.match(restored.heroImage.url, /restored\.png/)
  assert.equal(api.getStorageAssetDiagnostics()[0].status, 'accessible')
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
  const result = await api.create('projects', project({ techStack: ['Supabase', 'React'] }))

  assert.equal(result.id, 'project-1')
  assert.equal(result.status, 'draft')
  assert.equal(savedArgs.p_id, null)
  assert.equal(savedArgs.p_expected_revision, 0)
  assert.equal(savedArgs.p_payload.slug, 'editorial-project')
  assert.deepEqual(savedArgs.p_payload.techStack.map(({ name }) => name), ['Supabase', 'React'])
})

test('education and experience draft saves preserve skills and optional document references', async () => {
  const saved = []
  const client = mockClient(async (name, args) => {
    assert.equal(name, 'cms_save_record')
    saved.push(args)
    return {
      data: { id: args.p_id || `record-${saved.length}`, ...args.p_payload, status: 'draft', revision: saved.length },
      error: null,
    }
  })
  const api = createSupabaseCmsApi(client)
  await api.create('education', {
    degree: 'Other',
    customDegree: 'Advanced Certificate',
    institution: 'Example University',
    startYear: 2020,
    credentialImage: { url: '', storagePath: `${PRIVATE_BUCKET}/drafts/admin/certificate.png` },
  })
  await api.create('experiences', {
    role: 'Engineer',
    company: 'Example Studio',
    startDate: '2024-01-01',
    skills: ['Supabase', 'React'],
    recommendationLetter: { url: '', storagePath: `${PRIVATE_BUCKET}/drafts/admin/recommendation.png` },
    recommendationLetterUrl: 'https://example.test/recommendation',
  })

  assert.equal(saved[0].p_type, 'education')
  assert.equal(saved[0].p_payload.degree, 'Other')
  assert.equal(saved[0].p_payload.customDegree, 'Advanced Certificate')
  assert.equal(saved[0].p_payload.credentialImage.storagePath, `${PRIVATE_BUCKET}/drafts/admin/certificate.png`)
  assert.equal(saved[1].p_type, 'experiences')
  assert.deepEqual(saved[1].p_payload.skills, ['Supabase', 'React'])
  assert.equal(saved[1].p_payload.recommendationLetter.storagePath, `${PRIVATE_BUCKET}/drafts/admin/recommendation.png`)
  assert.equal(saved[1].p_payload.recommendationLetterUrl, 'https://example.test/recommendation')
})

test('experience saves normalize legacy skills and publishing retains them when other fields change', async () => {
  const calls = []
  let draft = {
    id: 'experience-1',
    role: 'Engineer',
    company: 'Example Studio',
    startDate: '2024-01-01',
    isCurrent: false,
    endDate: '',
    skills: 'IT Support, Network Administration, Windows Server, Database Management, Technical Support',
    description: 'Original description',
    status: 'draft',
    revision: 3,
  }
  const client = mockClient(async (name, args) => {
    calls.push([name, args])
    if (name === 'cms_save_record') {
      draft = { id: 'experience-1', ...args.p_payload, status: 'draft', revision: 4 }
      return { data: draft, error: null }
    }
    if (name === 'cms_get_record') return { data: draft, error: null }
    if (name === 'cms_publish_record') {
      return { data: { id: 'experience-1', ...args.p_payload, status: 'published', revision: 5 }, error: null }
    }
    throw new Error(`Unexpected RPC ${name}`)
  })
  const api = createSupabaseCmsApi(client)
  const saved = await api.save('experiences', 'experience-1', {
    ...draft,
    description: 'Updated description only',
  }, 3)

  assert.deepEqual(saved.skills, [
    'IT Support',
    'Network Administration',
    'Windows Server',
    'Database Management',
    'Technical Support',
  ])
  assert.equal(saved.description, 'Updated description only')
  assert.deepEqual(calls[0][1].p_payload.skills, saved.skills)

  const published = await api.publish('experiences', 'experience-1', 4)
  const publishCall = calls.find(([name]) => name === 'cms_publish_record')
  assert.equal(published.status, 'published')
  assert.deepEqual(publishCall[1].p_payload.skills, saved.skills)
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

test('background document uploads are private, admin-authorized Storage uploads', async () => {
  const client = mockClient(async () => ({ data: true, error: null }))
  const api = createSupabaseCmsApi(client)
  const progress = []
  const asset = await api.uploadPrivateAsset(imageFile(), {
    onProgress: (value) => progress.push(value),
  })

  assert.match(asset.storagePath, new RegExp(`^${PRIVATE_BUCKET}/drafts/${client.auth ? '11111111-1111-4111-8111-111111111111' : ''}/`))
  assert.match(asset.url, /^https:\/\/signed\.example\//)
  assert.equal(asset.mimeType, 'image/png')
  assert.ok(client.storageCalls.some(([operation, bucket]) => operation === 'upload' && bucket === PRIVATE_BUCKET))
  assert.deepEqual(progress, [5, 85, 100])
})

test('non-admin users cannot upload background document assets', async () => {
  const client = mockClient(async () => ({ data: true, error: null }), { isAdmin: false })
  const api = createSupabaseCmsApi(client)

  await assert.rejects(
    api.uploadPrivateAsset(imageFile()),
    (error) => error instanceof SupabaseCmsError && error.state === 'auth',
  )
  assert.equal(client.storageCalls.some(([operation]) => operation === 'upload'), false)
})

test('background asset cleanup accepts only private paths and keeps referenced files', async () => {
  const referencedPath = `${PRIVATE_BUCKET}/drafts/admin/referenced.png`
  const client = mockClient(async (name, args) => {
    if (name === 'cms_list_records' && args.p_type === 'projects' && args.p_view === 'published') {
      return {
        data: [{
          id: 'project-1',
          ...project({ heroImage: { url: '', storagePath: referencedPath } }),
          status: 'draft',
        }],
        error: null,
      }
    }
    if (name === 'cms_list_records') return { data: [], error: null }
    if (name === 'cms_get_settings') return { data: null, error: null }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const api = createSupabaseCmsApi(client)

  await api.discardUnreferencedPrivateAssets([referencedPath])
  assert.equal(client.storageCalls.some(([operation]) => operation === 'remove'), false)
  await assert.rejects(
    api.discardUnreferencedPrivateAssets([`${PUBLIC_BUCKET}/published/document.png`]),
    (error) => error instanceof SupabaseCmsError && error.state === 'validation',
  )

  await api.discardUnreferencedPrivateAssets([`${PRIVATE_BUCKET}/drafts/admin/unused.png`])
  assert.ok(client.storageCalls.some(([operation, bucket, paths]) =>
    operation === 'remove'
    && bucket === PRIVATE_BUCKET
    && paths.includes('drafts/admin/unused.png'),
  ))
})

test('education publishing promotes credential images through the existing gate', async () => {
  const sourcePath = `${PRIVATE_BUCKET}/drafts/admin/education/certificate.png`
  let publicationPayload
  const client = mockClient(async (name, args) => {
    if (name === 'cms_get_record') {
      return {
        data: {
          id: 'education-1',
          degree: 'BSc Degree',
          institution: 'Example University',
          startYear: 2020,
          endYear: 2024,
          credentialUrl: 'https://example.test/credential',
          credentialImage: { url: '', storagePath: sourcePath },
          visibility: true,
          order: 0,
          status: 'draft',
          revision: 3,
          publishedRevision: 2,
          basePublishedRevision: 2,
        },
        error: null,
      }
    }
    if (name === 'cms_health') return { data: { storage: { ready: true } }, error: null }
    if (name === 'cms_publish_record') {
      publicationPayload = args.p_payload
      return { data: { id: args.p_id, ...args.p_payload, status: 'published', revision: 3 }, error: null }
    }
    if (name === 'cms_list_records') return { data: [], error: null }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const api = createSupabaseCmsApi(client)
  const result = await api.publish('education', 'education-1', 3)

  assert.equal(publicationPayload.credentialImage.storagePath, `${PUBLIC_BUCKET}/published/drafts/admin/education/certificate.png`)
  assert.equal(publicationPayload.credentialImage.url, 'https://public.example/published/drafts/admin/education/certificate.png')
  assert.equal(result.status, 'published')
  assert.ok(client.storageCalls.some(([operation, bucket]) => operation === 'download' && bucket === PRIVATE_BUCKET))
  assert.ok(client.storageCalls.some(([operation, bucket]) => operation === 'upload' && bucket === PUBLIC_BUCKET))
})

test('settings publishing promotes built-in and custom social logos before exposing public references', async () => {
  const sourcePath = `${PRIVATE_BUCKET}/drafts/admin/social/facebook.png`
  const builtInSourcePath = `${PRIVATE_BUCKET}/drafts/admin/social/github.png`
  let publishedPayload
  const calls = []
  const client = mockClient(async (name, args) => {
    calls.push(name)
    if (name === 'cms_get_settings') {
      return {
        data: {
          id: 'settings',
          name: 'Fitsum',
          title: 'Developer',
          bio: '',
          about: '',
          location: '',
          socialLinks: { github: 'https://github.com/fitsum' },
          socialLinkDetails: {
            github: {
              platform: 'GitHub',
              enabled: true,
              logo: { url: '', storagePath: builtInSourcePath, fileName: 'github.png', mimeType: 'image/png' },
            },
          },
          customSocialLinks: [{
            id: 'custom-facebook',
            platform: 'Facebook',
            url: 'https://facebook.com/fitsum',
            logo: { url: '', storagePath: sourcePath, fileName: 'facebook.png', mimeType: 'image/png' },
          }],
          featuredProjectIds: [],
          seo: {},
          visibility: true,
          status: 'draft',
          revision: 3,
          publishedRevision: 2,
          basePublishedRevision: 2,
        },
        error: null,
      }
    }
    if (name === 'cms_health') return { data: { storage: { ready: true } }, error: null }
    if (name === 'cms_publish_settings_with_assets') {
      publishedPayload = args.p_payload
      return { data: { id: 'settings', ...args.p_payload, status: 'published' }, error: null }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const api = createSupabaseCmsApi(client)

  await api.publishSettings(3)

  const logo = publishedPayload.customSocialLinks[0].logo
  const builtInLogo = publishedPayload.socialLinkDetails.github.logo
  assert.equal(logo.storagePath, `${PUBLIC_BUCKET}/published/drafts/admin/social/facebook.png`)
  assert.equal(logo.url, 'https://public.example/published/drafts/admin/social/facebook.png')
  assert.equal(builtInLogo.storagePath, `${PUBLIC_BUCKET}/published/drafts/admin/social/github.png`)
  assert.equal(builtInLogo.url, 'https://public.example/published/drafts/admin/social/github.png')
  assert.equal(publishedPayload.visibility, true)
  assert.equal(calls.includes('cms_publish_settings_with_assets'), true)
  assert.equal(calls.includes('cms_publish_settings'), false)
  assert.deepEqual(client.projectionCalls.slice(-3), [
    ['select', 'portfolio_cms_public_settings', 'published_payload'],
    ['eq', 'portfolio_cms_public_settings', 'id', 'main'],
    ['maybeSingle', 'portfolio_cms_public_settings'],
  ])
  assert.ok(client.storageCalls.some(([operation, bucket]) => operation === 'download' && bucket === PRIVATE_BUCKET))
  assert.ok(client.storageCalls.some(([operation, bucket]) => operation === 'upload' && bucket === PUBLIC_BUCKET))
})

test('Supabase settings save and publish round-trip an explicitly empty social configuration', async () => {
  let draft
  let published
  let revision = 0
  const client = mockClient(async (name, args) => {
    if (name === 'cms_save_settings') {
      revision += 1
      draft = {
        ...args.p_payload,
        id: 'settings',
        status: 'draft',
        revision,
        publishedRevision: revision - 1,
        basePublishedRevision: revision - 1,
      }
      return { data: draft, error: null }
    }
    if (name === 'cms_get_settings') {
      return { data: args.p_view === 'published' ? published : draft, error: null }
    }
    if (name === 'cms_publish_settings_with_assets') {
      published = {
        ...args.p_payload,
        id: 'settings',
        status: 'published',
        revision,
        publishedRevision: revision,
      }
      return { data: published, error: null }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const api = createSupabaseCmsApi(client)
  const saved = await api.saveSettings({
    name: 'Fitsum',
    title: 'Developer',
    socialLinks: { email: 'mailto:contact@example.com' },
    socialLinkDetails: {},
    socialLinkDisplayOrders: {},
    customSocialLinks: [],
    seo: { metaTitle: 'Preserved title', metaDescription: 'Preserved description' },
    visibility: false,
  }, 0)
  const reloadedDraft = await api.getSettings('drafts')

  assert.deepEqual(reloadedDraft.socialLinks, { email: 'mailto:contact@example.com' })
  assert.deepEqual(reloadedDraft.socialLinkDetails, {})
  assert.deepEqual(reloadedDraft.socialLinkDisplayOrders, {})
  assert.deepEqual(reloadedDraft.customSocialLinks, [])
  assert.deepEqual(reloadedDraft.seo, { metaTitle: 'Preserved title', metaDescription: 'Preserved description' })
  assert.equal(reloadedDraft.visibility, false)

  await api.publishSettings(saved.revision)
  const reloadedPublished = await api.getSettings('published')
  assert.deepEqual(reloadedPublished.socialLinks, { email: 'mailto:contact@example.com' })
  assert.deepEqual(reloadedPublished.customSocialLinks, [])
  assert.deepEqual(reloadedPublished.seo, { metaTitle: 'Preserved title', metaDescription: 'Preserved description' })
  assert.equal(reloadedPublished.visibility, true)
  assert.deepEqual(client.projectionCalls.slice(-3), [
    ['select', 'portfolio_cms_public_settings', 'published_payload'],
    ['eq', 'portfolio_cms_public_settings', 'id', 'main'],
    ['maybeSingle', 'portfolio_cms_public_settings'],
  ])
})

test('settings publish fails visibly when the public settings projection cannot be read', async () => {
  const draft = {
    id: 'settings',
    status: 'draft',
    revision: 1,
    publishedRevision: 0,
    basePublishedRevision: 0,
    name: 'Fitsum',
    socialLinks: { email: 'mailto:contact@example.com' },
    socialLinkDetails: {},
    socialLinkDisplayOrders: {},
    customSocialLinks: [],
    visibility: false,
  }
  const client = mockClient(async (name) => {
    if (name === 'cms_get_settings') return { data: draft, error: null }
    if (name === 'cms_publish_settings_with_assets') {
      return {
        data: { ...draft, status: 'published', visibility: true, publishedRevision: 1 },
        error: null,
      }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  client.from = (table) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: null,
          error: null,
        }),
      }),
    }),
  })
  const api = createSupabaseCmsApi(client)

  await assert.rejects(
    api.publishSettings(1),
    /public settings projection is not readable/,
  )
})

test('settings publishing withdraws the public projection when custom-logo copy fails', async () => {
  const sourcePath = `${PRIVATE_BUCKET}/drafts/admin/social/failing-logo.png`
  const calls = []
  const client = mockClient(async (name) => {
    calls.push(name)
    if (name === 'cms_get_settings') {
      return {
        data: {
          id: 'settings',
          name: 'Fitsum',
          socialLinks: {},
          customSocialLinks: [{
            id: 'custom-facebook',
            platform: 'Facebook',
            url: 'https://facebook.com/fitsum',
            logo: { url: '', storagePath: sourcePath, fileName: 'failing-logo.png', mimeType: 'image/png' },
          }],
          visibility: true,
          status: 'draft',
          revision: 2,
          publishedRevision: 1,
          basePublishedRevision: 1,
        },
        error: null,
      }
    }
    if (name === 'cms_health') return { data: { storage: { ready: true } }, error: null }
    if (name === 'cms_publish_settings_with_assets') return { data: { id: 'settings', status: 'published' }, error: null }
    if (name === 'cms_unpublish_settings') return { data: { status: 'unpublished' }, error: null }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const storageFrom = client.storage.from.bind(client.storage)
  client.storage.from = (bucket) => {
    const storage = storageFrom(bucket)
    if (bucket === PRIVATE_BUCKET) {
      storage.download = async () => ({ data: null, error: { message: 'source upload is missing' } })
    }
    return storage
  }
  const api = createSupabaseCmsApi(client)

  await assert.rejects(
    api.publishSettings(2),
    (error) => error instanceof SupabaseCmsError && error.state === 'upload' && /rolled back/.test(error.message),
  )
  assert.equal(calls.includes('cms_unpublish_settings'), true)
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
    cardImage: {
      url: 'https://signed.example/card.png',
      storagePath: 'portfolio-private/drafts/admin/project-1/card.png',
      caption: '',
      order: 0,
    },
    heroImage: {
      url: 'https://signed.example/draft.png',
      storagePath: 'portfolio-private/drafts/admin/project-1/hero.png',
      caption: '',
      order: 0,
    },
    gallery: [1, 2, 3].map((image) => ({
      url: `https://signed.example/gallery-${image}.png`,
      storagePath: `portfolio-private/drafts/admin/project-1/gallery-${image}.png`,
      caption: `Gallery ${image}`,
      order: image - 1,
    })),
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
  assert.equal(publishArgs.p_payload.cardImage.storagePath, 'portfolio-published/published/drafts/admin/project-1/card.png')
  assert.equal(publishArgs.p_payload.cardImage.url, 'https://public.example/published/drafts/admin/project-1/card.png')
  assert.deepEqual(publishArgs.p_payload.gallery.map((image) => image.storagePath), [1, 2, 3].map(
    (image) => `portfolio-published/published/drafts/admin/project-1/gallery-${image}.png`,
  ))
  assert.deepEqual(publishArgs.p_payload.gallery.map((image) => image.url), [1, 2, 3].map(
    (image) => `https://public.example/published/drafts/admin/project-1/gallery-${image}.png`,
  ))
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

test('publication verification migration removes the global audit from public RLS and fails closed on relevant writes', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261105120000_version_public_cms_verification.sql', import.meta.url),
    'utf8',
  )
  const normalizedMigration = migration.replace(/\r\n/g, '\n')
  const policy = migration.slice(
    migration.indexOf('create policy portfolio_cms_public_projection_read'),
    migration.indexOf('drop trigger if exists portfolio_cms_publication_verification_records'),
  )
  const reverify = migration.slice(
    migration.indexOf('create or replace function public.cms_reverify_publication_generation'),
    migration.indexOf('create or replace function public.cms_invalidate_publication_verification'),
  )
  const invalidate = migration.slice(
    migration.indexOf('create or replace function public.cms_invalidate_publication_verification'),
    migration.indexOf('create or replace function public.cms_verify_publication_after_mutation'),
  )

  assert.match(migration, /create table if not exists public\.portfolio_cms_publication_verification/)
  assert.match(migration, /do \$verification_schema_contract\$[\s\S]*incompatible column layout[\s\S]*incompatible singleton or generation-consistency constraints/)
  assert.match(migration, /alter table public\.portfolio_cms_publication_verification enable row level security/)
  assert.match(migration, /revoke all on public\.portfolio_cms_publication_verification[\s\S]*from public, anon, authenticated/)
  assert.match(policy, /published_payload ->> 'visibility' = 'true'/)
  assert.match(policy, /select public\.cms_publication_generation_is_verified\(\)/)
  assert.doesNotMatch(policy, /cms_public_content_audited/)
  assert.match(reverify, /for update/)
  assert.match(reverify, /if not public\.cms_public_content_audited\(\) then[\s\S]{0,300}checked_generation = v_generation[\s\S]{0,200}return false/)
  assert.match(reverify, /verified_generation = v_generation/)
  assert.match(invalidate, /publication_generation = publication_generation \+ 1/)
  assert.match(invalidate, /verified_generation = null,\s+verified_at = null/)
  assert.match(invalidate, /portfolio_cms_records/)
  assert.match(migration, /create trigger portfolio_cms_publication_verification_projection/)
  assert.match(invalidate, /portfolio_cms_settings/)
  assert.match(migration, /create trigger portfolio_cms_publication_verification_public_settings/)
  assert.match(invalidate, /storage/)
  assert.match(migration, /deferrable initially deferred/)
  for (const [table, relation] of [
    ['records', 'public.portfolio_cms_records'],
    ['projection', 'public.portfolio_cms_public_records'],
    ['settings', 'public.portfolio_cms_settings'],
    ['public_settings', 'public.portfolio_cms_public_settings'],
    ['buckets', 'storage.buckets'],
  ]) {
    assert.ok(
      normalizedMigration.includes(
        `create trigger portfolio_cms_publication_verification_${table}_truncate\n  after truncate on ${relation}`,
      ),
    )
  }
  assert.match(migration, /create or replace function public\.cms_reverify_publication_generation[\s\S]*for update/)
  assert.match(migration, /create or replace function public\.cms_publication_generation_is_verified[\s\S]*stable[\s\S]*security definer[\s\S]*set search_path = ''/)
  assert.match(migration, /create or replace function public\.cms_publication_block_reason[\s\S]*?cms_publication_generation_is_verified\(\)/)
  assert.match(migration, /'publicProjectionEligible', public\.cms_publication_generation_is_verified\(\)/)
  assert.match(migration, /revoke all on function public\.cms_public_content_audited\(\)[\s\S]*from public, anon, authenticated/)
  assert.match(migration.trim(), /commit;[\s\S]*notify pgrst, 'reload schema';$/i)
})

test('publication audit dependencies are invalidated for row mutations and TRUNCATE', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261105120000_version_public_cms_verification.sql', import.meta.url),
    'utf8',
  )
  const normalizedMigration = migration.replace(/\r\n/g, '\n')
  const auditMigration = await readFile(
    new URL('../supabase/migrations/20261105103000_consolidate_public_storage_audit.sql', import.meta.url),
    'utf8',
  )
  const audit = auditMigration.slice(
    auditMigration.indexOf('create or replace function public.cms_public_content_audited'),
    auditMigration.indexOf('revoke all on function public.cms_jsonb_has_unsafe_public_storage_reference'),
  )
  for (const [table, trigger] of [
    ['public.portfolio_cms_records', 'portfolio_cms_publication_verification_records'],
    ['public.portfolio_cms_public_records', 'portfolio_cms_publication_verification_projection'],
    ['public.portfolio_cms_settings', 'portfolio_cms_publication_verification_settings'],
    ['public.portfolio_cms_public_settings', 'portfolio_cms_publication_verification_public_settings'],
    ['storage.buckets', 'portfolio_cms_publication_verification_buckets'],
  ]) {
    assert.ok(audit.includes(table), `audit dependency ${table} is present`)
    assert.ok(
      normalizedMigration.includes(
        `create trigger ${trigger}\n  after insert or update or delete on ${table}`,
      ),
      `row invalidation trigger exists for ${table}`,
    )
    assert.ok(
      normalizedMigration.includes(
        `create trigger ${trigger}_truncate\n  after truncate on ${table}`,
      ),
      `TRUNCATE invalidation trigger exists for ${table}`,
    )
  }
  assert.doesNotMatch(audit, /storage\.objects/)
  assert.match(migration, /revoke all on function public\.cms_invalidate_publication_verification[\s\S]*from public, anon, authenticated/)
  assert.match(migration, /revoke all on function public\.cms_verify_publication_after_mutation[\s\S]*from public, anon, authenticated/)
})

test('publication verification includes paired two-session concurrency scripts', async () => {
  const setup = await readFile(
    new URL('../supabase/validation/09_publication_concurrency_setup.sql', import.meta.url),
    'utf8',
  )
  const sessionA = await readFile(
    new URL('../supabase/validation/09_publication_concurrency_session_a.sql', import.meta.url),
    'utf8',
  )
  const sessionB = await readFile(
    new URL('../supabase/validation/09_publication_concurrency_session_b.sql', import.meta.url),
    'utf8',
  )
  const cleanup = await readFile(
    new URL('../supabase/validation/09_publication_concurrency_cleanup.sql', import.meta.url),
    'utf8',
  )

  assert.match(setup, /cms_save_record[\s\S]*validation-concurrency-a/)
  assert.match(setup, /cms_save_record[\s\S]*validation-concurrency-b/)
  assert.match(sessionA, /cms_publish_record\([\s\S]*validation-concurrency-a/)
  assert.match(sessionA, /audit-owner/)
  assert.match(sessionB, /cms_publish_record\([\s\S]*validation-concurrency-b/)
  assert.match(sessionB, /concurrent-invalidator/)
  assert.match(sessionA, /pg_sleep\(8\)/)
  assert.match(sessionB, /pg_sleep\(2\)/)
  assert.match(sessionB, /overwritten by an older audit/)
  assert.match(cleanup, /cms_delete_record/)
})

test('publication verification integration covers settings, direct projections, rollback and truncation', async () => {
  const sql = await readFile(
    new URL('../supabase/validation/08_publication_verification.sql', import.meta.url),
    'utf8',
  )

  assert.match(sql, /validation-private-media-draft/)
  assert.match(sql, /source_settings_mismatch_fails_closed/)
  assert.match(sql, /direct_settings_projection_update_fails_closed/)
  assert.match(sql, /direct_settings_projection_delete_fails_closed/)
  assert.match(sql, /direct_record_projection_update_fails_closed/)
  assert.match(sql, /direct_record_projection_delete_fails_closed/)
  assert.match(sql, /rolled_back_mutation_is_atomic/)
  assert.match(sql, /multiple_mutations_share_final_verification/)
  assert.match(sql, /portfolio-private.*public = true|set public = true[\s\S]*portfolio-private/)
  assert.match(sql, /truncate_invalidates_and_stays_closed/)
  assert.match(sql.trim(), /rollback;$/i)
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

test('repair migration installs the exact admin-only settings publish RPC and reloads PostgREST', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261102182000_repair_settings_publish_rpc.sql', import.meta.url),
    'utf8',
  )

  assert.match(migration, /create or replace function public\.cms_publish_settings_with_assets\(\s*p_expected_revision integer,\s*p_payload jsonb\s*\)/)
  assert.match(migration, /to_regprocedure\('public\.cms_publish_settings_with_assets\(integer,jsonb\)'\)/)
  assert.match(migration, /v_argument_names\[1\] is distinct from 'p_expected_revision'/)
  assert.match(migration, /v_argument_names\[2\] is distinct from 'p_payload'/)
  assert.match(migration, /drop function public\.cms_publish_settings_with_assets\(integer, jsonb\)/)
  assert.match(migration, /security definer\s+set search_path = ''/)
  assert.match(migration, /cms_require_portfolio_admin\(\)/)
  assert.match(migration, /cms_publication_block_reason\(\)/)
  assert.match(migration, /v_current\.revision <> p_expected_revision/)
  assert.match(migration, /v_current\.base_published_revision <> v_current\.published_revision/)
  assert.match(migration, /jsonb_set\([\s\S]*?'\{visibility\}',\s*'true'::jsonb/)
  for (const bucket of ['portfolio-private', 'portfolio_media', 'portfolio-media', 'portfolio-media.']) {
    assert.ok(migration.includes(`cms_jsonb_uses_storage_bucket(v_payload, '${bucket}')`))
  }
  assert.match(migration, /cms_jsonb_has_unknown_storage_bucket\(v_payload\)/)
  assert.match(migration, /published_payload = v_payload/)
  assert.match(migration, /return public\.cms_get_settings\('published'\)/)
  assert.match(migration, /revoke all on function public\.cms_publish_settings_with_assets\(integer, jsonb\) from public, anon, authenticated/)
  assert.match(migration, /grant execute on function public\.cms_publish_settings_with_assets\(integer, jsonb\) to authenticated/)
  assert.match(migration, /commit;\s*notify pgrst, 'reload schema';\s*$/i)
})

test('social settings asset publication migration keeps the Storage audit and private-path guards', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261030120000_social_settings_asset_publication.sql', import.meta.url),
    'utf8',
  )

  assert.match(migration, /create or replace function public\.cms_publish_settings_with_assets/)
  assert.match(migration, /cms_require_portfolio_admin\(\)/)
  assert.match(migration, /cms_publication_block_reason\(\)/)
  assert.match(migration, /v_current\.revision <> p_expected_revision/)
  assert.match(migration, /published_payload = v_payload/)
  assert.match(migration, /cms_jsonb_uses_storage_bucket\(v_payload, 'portfolio-private'\)/)
  assert.match(migration, /cms_jsonb_has_unknown_storage_bucket\(v_payload\)/)
  assert.match(migration, /grant execute on function public\.cms_publish_settings_with_assets\(integer, jsonb\) to authenticated/)
})

test('public lifecycle validation covers publish, unpublish, delete, republish, stale parity, and audit invalidation', async () => {
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
  assert.match(sql, /republish_verified/)
  assert.match(sql, /anonymous_after_republish/)
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

test('admin password recovery uses Supabase recovery events and never treats recovery as dashboard login', async () => {
  const auth = await readFile(
    new URL('../src/lib/adminAuth.jsx', import.meta.url),
    'utf8',
  )
  const login = await readFile(
    new URL('../src/admin/AdminLogin.jsx', import.meta.url),
    'utf8',
  )
  const forgotPassword = await readFile(
    new URL('../src/admin/AdminForgotPassword.jsx', import.meta.url),
    'utf8',
  )
  const recovery = await readFile(
    new URL('../src/admin/AdminPasswordRecovery.jsx', import.meta.url),
    'utf8',
  )
  const app = await readFile(
    new URL('../src/admin/AdminApp.jsx', import.meta.url),
    'utf8',
  )
  const viteConfig = await readFile(
    new URL('../vite.config.js', import.meta.url),
    'utf8',
  )
  const siteUrls = await readFile(
    new URL('../src/lib/siteUrls.js', import.meta.url),
    'utf8',
  )
  const netlifyConfig = await readFile(
    new URL('../netlify.toml', import.meta.url),
    'utf8',
  )
  const supabaseClient = await readFile(
    new URL('../src/lib/supabase.js', import.meta.url),
    'utf8',
  )

  assert.match(auth, /resetPasswordForEmail\(email\.trim\(\),\s*\{\s*redirectTo: getAdminRecoveryRedirectUrl\(/)
  assert.match(auth, /configuredRedirectUrl: import\.meta\.env\.VITE_ADMIN_RECOVERY_REDIRECT_URL/)
  assert.match(siteUrls, /export function getAdminRecoveryRedirectUrl/)
  assert.match(siteUrls, /new URL\('\/admin\/reset-password', baseUrl\)\.toString\(\)/)
  assert.ok(siteUrls.includes('VITE_ADMIN_RECOVERY_REDIRECT_URL must end in /admin/reset-password'))
  assert.ok(siteUrls.includes('before requesting recovery from localhost'))
  assert.match(auth, /import\.meta\.env\.DEV/)
  assert.match(auth, /Password recovery request failed/)
  assert.match(auth, /redacted email/)
  assert.match(auth, /redacted token/)
  assert.match(viteConfig, /port:\s*3000/)
  assert.match(viteConfig, /strictPort:\s*true/)
  assert.match(siteUrls, /return 'http:\/\/localhost:3000\/'/)
  assert.match(auth, /event === 'PASSWORD_RECOVERY'/)
  assert.match(supabaseClient, /detectSessionInUrl:\s*true/)
  assert.match(auth, /isLocalAuthFlowRoute/)
  assert.match(auth, /recoveryActiveRef\.current = true/)
  assert.match(auth, /recoveryAvailable: Boolean\(supabase && isSupabaseConfigured\)/)
  assert.match(auth, /if \(!recoveryActiveRef\.current\)[\s\S]*resolveSession/)
  assert.match(login, /Forgot Password\?/)
  assert.match(login, /adminForgotPasswordPath/)
  assert.match(login, /href=\{adminForgotPasswordPath\(\)\}/)
  assert.match(forgotPassword, /requestPasswordReset\(email\)/)
  assert.match(forgotPassword, /If an administrator account exists for that email/)
  assert.match(forgotPassword, /const submittingRef = useRef\(false\)/)
  assert.match(forgotPassword, /if \(submittingRef\.current\) return/)
  assert.match(forgotPassword, /<form className="cms-login-form" onSubmit=\{submit\}/)
  assert.match(forgotPassword, /Send reset link/)
  assert.match(recovery, /supabase\.rpc\('cms_is_admin'\)/)
  assert.match(recovery, /supabase\.auth\.updateUser\(\{ password \}\)/)
  assert.match(recovery, /aria-label=\{showPassword \? 'Hide new password' : 'Show new password'\}/)
  assert.match(recovery, /aria-label=\{showConfirmation \? 'Hide password confirmation' : 'Show password confirmation'\}/)
  assert.match(recovery, /password\.length < 8/)
  assert.match(recovery, /password !== confirmation/)
  assert.match(recovery, /supabase\.auth\.signOut\(\)/)
  assert.match(app, /resetPasswordRoute = currentPath === '\/reset-password'/)
  assert.match(app, /forgotPasswordRoute = currentPath === '\/forgot-password'/)
  assert.match(app, /if \(forgotPasswordRoute\) return <AdminForgotPassword \/>/)
  assert.match(app, /if \(resetPasswordRoute\) return <AdminPasswordRecovery \/>/)
  assert.match(recovery, /history\.replaceState\(window\.history\.state, '', window\.location\.pathname\)/)
  assert.match(netlifyConfig, /from = "\/\*"\s+to = "\/index\.html"\s+status = 200/)
  assert.match(netlifyConfig, /from = "\/\*"\s+to = "\/index\.html"\s+status = 200/)
})
