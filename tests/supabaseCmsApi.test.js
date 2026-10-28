import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSupabaseCmsApi,
  MAX_IMAGE_BYTES,
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

function mockClient(rpc) {
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
        async list(path, options) {
          storageCalls.push(['list', bucket, path, options])
          return { data: [], error: null }
        },
        async copy(source, destinationBucket, destination) {
          storageCalls.push(['copy', bucket, source, destinationBucket, destination])
          return { error: null }
        },
        getPublicUrl(path) {
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
    rpc: async (name, args) => rpc(name, args),
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
  assert.equal(publishArgs.p_payload.heroImage.storagePath, 'portfolio-media/published/drafts/admin/project-1/hero.png')
  assert.equal(result.status, 'published')
  assert.ok(client.storageCalls.some(([operation]) => operation === 'copy'))
})

test('a failed media publish keeps the saved draft and uploaded file intact', async () => {
  const client = mockClient(async (name, args) => {
    if (name === 'cms_save_record') {
      return { data: { id: 'media-1', ...args.p_payload, status: 'draft', revision: 1 }, error: null }
    }
    if (name === 'cms_get_record') {
      return { data: { id: 'media-1', ...imageMedia(), status: 'draft', revision: 1 }, error: null }
    }
    if (name === 'cms_publish_record') {
      return { data: null, error: { code: '40001', message: 'A newer revision exists.' } }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const api = createSupabaseCmsApi(client)

  await assert.rejects(
    api.upload(imageFile(), { private: false }),
    (error) => error instanceof SupabaseCmsError && error.state === 'conflict',
  )
  assert.ok(client.storageCalls.some(([operation]) => operation === 'upload'))
  assert.equal(client.storageCalls.some(([operation]) => operation === 'remove'), false)
})

function imageMedia() {
  return {
    url: 'https://public.example/published/media-1.png',
    storagePath: 'portfolio-media/published/media-1.png',
    type: 'image',
    sizeBytes: 8,
    fileName: 'preview.png',
    mimeType: 'image/png',
    alt: '',
    sourceUrl: '',
    usedIn: [],
    visibility: true,
    order: 0,
  }
}
