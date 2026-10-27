import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import { createLocalCmsPlugin, createLocalCmsStore, verifyAdminToken } from '../dev/localCmsServer.js'

const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2kAAAAASUVORK5CYII=', 'base64')

function validPdf() {
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
  return Buffer.from(text, 'latin1')
}

function signedAdminToken(uid, privateKey, kid) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const header = encode({ alg: 'RS256', typ: 'JWT', kid })
  const claims = encode({
    aud: 'user-auth-vp',
    iss: 'https://securetoken.google.com/user-auth-vp',
    sub: uid,
    user_id: uid,
    iat: now,
    exp: now + 3600,
    auth_time: now,
  })
  const signingInput = `${header}.${claims}`
  return `${signingInput}.${sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')}`
}

async function callPlugin(middleware, { url, method = 'GET', body = '', headers = {} }) {
  const chunks = body ? [Buffer.from(body)] : []
  const req = Readable.from(chunks)
  Object.assign(req, { url, method, headers, socket: { remoteAddress: '127.0.0.1' } })
  const responseHeaders = {}
  const res = {
    statusCode: 0,
    setHeader(name, value) { responseHeaders[name.toLowerCase()] = value },
    end(value) { this.body = value },
  }
  await middleware(req, res, () => { throw new Error('Request unexpectedly bypassed the local CMS route.') })
  const rawBody = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body || '')
  const responseBody = responseHeaders['content-type']?.includes('application/json')
    ? JSON.parse(rawBody.toString('utf8'))
    : rawBody
  return { status: res.statusCode, headers: responseHeaders, body: responseBody }
}

function multipart(boundary, fields, file) {
  const parts = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`))
  parts.push(file.bytes)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  return Buffer.concat(parts)
}

function project(overrides = {}) {
  return {
    title: 'Local disk project',
    slug: 'local-disk-project',
    category: 'Web',
    synopsis: 'Filesystem provider test.',
    heroImage: { url: '', storagePath: '', caption: '', order: 0 },
    gallery: [],
    ...overrides,
  }
}

async function withStore(run) {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'fitsum-local-cms-'))
  try { await run(dataDirectory) } finally { await rm(dataDirectory, { recursive: true, force: true }) }
}

test('local JSON CMS persists CRUD, publication, drafts, settings, and deletes across store restarts', async () => {
  await withStore(async (directory) => {
    let store = createLocalCmsStore(directory)
    assert.equal((await store.health()).mode, 'local-filesystem')
    assert.deepEqual(await store.list('projects', 'published'), [])

    const projectDraft = await store.create('projects', project())
    assert.equal(projectDraft.status, 'draft')
    assert.equal((await store.publishedRecords('projects')).length, 0)
    const updated = await store.save('projects', projectDraft.id, project({ title: 'Edited disk project', slug: 'edited-disk-project' }), projectDraft.revision)
    await store.publish('projects', updated.id, updated.revision)
    assert.equal((await store.publishedDocument('projects', updated.id)).title, 'Edited disk project')

    const experience = await store.create('experiences', {
      role: 'Engineer', company: 'Local Studio', startDate: '2022-01-01', isCurrent: true,
    })
    const education = await store.create('education', {
      degree: 'BSc', institution: 'Local University', startYear: 2020, endYear: 2024,
    })
    await store.publish('experiences', experience.id, experience.revision)
    await store.publish('education', education.id, education.revision)
    assert.equal((await store.publishedRecords('experiences')).length, 1)
    assert.equal((await store.publishedRecords('education')).length, 1)
    await store.unpublish('experiences', experience.id)
    assert.equal((await store.publishedDocument('experiences', experience.id)), null)

    const settings = await store.getSettings()
    const savedSettings = await store.saveSettings({ ...settings, name: 'Local Filesystem Profile' }, settings.revision)
    assert.equal((await store.publishedSettings()).name, settings.name)
    await store.publishSettings(savedSettings.revision)
    assert.equal((await store.publishedSettings()).name, 'Local Filesystem Profile')

    store = createLocalCmsStore(directory)
    assert.equal((await store.get('projects', updated.id, 'published')).title, 'Edited disk project')
    assert.equal((await store.getSettings('published')).name, 'Local Filesystem Profile')

    await store.deleteItem('education', education.id)
    assert.equal(await store.publishedDocument('education', education.id), null)
    assert.equal((await store.get('education', education.id, 'published')).status, 'deleted')
    assert.ok(JSON.parse(await readFile(path.join(directory, 'content.json'), 'utf8')).published.projects.length > 0)
  })
})

test('local image upload and replacement persist bytes and update published project references', async () => {
  await withStore(async (directory) => {
    const store = createLocalCmsStore(directory)
    const first = await store.upload({ bytes: imageBytes, fileName: 'cover.png', mimeType: 'image/png', kind: 'image', alt: 'First cover' })
    assert.match(first.url, /^\/__local-cms\/uploads\//)
    assert.deepEqual((await store.serveUpload(first.storagePath)).contents, imageBytes)

    const draft = await store.create('projects', project({
      heroImage: { url: first.url, storagePath: first.storagePath, caption: 'Cover', order: 0 },
    }))
    await store.publish('projects', draft.id, draft.revision)
    const replacementBytes = Buffer.from(imageBytes)
    replacementBytes[20] = replacementBytes[20] ^ 0x01
    const replacement = await store.upload({
      bytes: replacementBytes, fileName: 'replacement.png', mimeType: 'image/png', kind: 'image', replaceMediaId: first.id,
    })
    const published = await store.get('projects', draft.id, 'published')
    assert.equal(replacement.id, first.id)
    assert.equal(published.heroImage.url, replacement.url)
    assert.equal(published.heroImage.storagePath, replacement.storagePath)
    assert.deepEqual((await store.serveUpload(replacement.storagePath)).contents, replacementBytes)
    assert.equal(await store.serveUpload(first.storagePath), null)

    const restarted = createLocalCmsStore(directory)
    assert.equal((await restarted.get('projects', draft.id, 'published')).heroImage.url, replacement.url)
  })
})

test('local resume upload validates PDF bytes and keeps the resume draft private until publish', async () => {
  await withStore(async (directory) => {
    const store = createLocalCmsStore(directory)
    const pdf = validPdf()
    const resume = await store.upload({ bytes: pdf, fileName: 'resume.pdf', mimeType: 'application/pdf', kind: 'resume' })
    assert.equal(resume.status, 'draft')
    assert.equal((await store.publishedRecords('resumes')).length, 0)
    assert.deepEqual((await store.serveUpload(resume.storagePath)).contents, pdf)
    await store.publish('resumes', resume.id, resume.revision)
    assert.equal((await store.publishedRecords('resumes')).length, 1)
    await assert.rejects(
      store.upload({ bytes: Buffer.from('not a PDF'), fileName: 'fake.pdf', mimeType: 'application/pdf', kind: 'resume' }),
      /structurally valid PDF/,
    )
  })
})

test('Firebase ID tokens are signature-checked and restricted to the configured admin UID', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const kid = `local-test-${Date.now()}`
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }
  const uid = 'authorized-local-admin'
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url')
  const token = signedAdminToken(uid, privateKey, kid)
  const fetchKeys = async () => ({
    ok: true,
    headers: { get: () => 'max-age=60' },
    json: async () => ({ keys: [jwk] }),
  })

  assert.equal(await verifyAdminToken(token, [uid], fetchKeys), uid)
  await assert.rejects(verifyAdminToken(token, ['different-admin'], fetchKeys), /not authorized/)
  const [, claims] = token.split('.')
  const tampered = `${header}.${claims}.${Buffer.alloc(256).toString('base64url')}`
  await assert.rejects(verifyAdminToken(tampered, [uid], fetchKeys), /not authorized|invalid/)
})

test('local HTTP API protects edits and exposes published records to the local public reader', async () => {
  await withStore(async (directory) => {
    let middleware
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const uid = 'http-test-admin'
    const kid = `local-http-test-${Date.now()}`
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }
    const plugin = createLocalCmsPlugin({
      dataDirectory: directory,
      adminUids: [uid],
      fetchImpl: async () => ({
        ok: true,
        headers: { get: () => 'max-age=60' },
        json: async () => ({ keys: [jwk] }),
      }),
    })
    plugin.configureServer({
      middlewares: { use(handler) { middleware = handler } },
      config: { logger: { error() {} } },
    })
    const health = await callPlugin(middleware, { url: '/api/health' })
    assert.equal(health.status, 200)
    assert.equal(health.body.data.mode, 'local-filesystem')

    const unauthenticated = await callPlugin(middleware, {
      url: '/api/projects',
      method: 'POST',
      body: JSON.stringify({ content: project() }),
      headers: { 'content-type': 'application/json' },
    })
    assert.equal(unauthenticated.status, 401)

    const token = signedAdminToken(uid, privateKey, kid)
    const created = await callPlugin(middleware, {
      url: '/api/projects',
      method: 'POST',
      body: JSON.stringify({ content: project() }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    assert.equal(created.status, 201)
    const record = created.body.data
    assert.equal(record.status, 'draft')

    const privateRead = await callPlugin(middleware, {
      url: `/api/projects/${record.id}?view=drafts`,
      headers: { 'x-firebase-id-token': token },
    })
    assert.equal(privateRead.status, 200)
    const publishedBefore = await callPlugin(middleware, { url: '/api/public/projects' })
    assert.equal(publishedBefore.body.data.length, 0)

    const boundary = 'local-cms-http-upload'
    const imageUpload = await callPlugin(middleware, {
      url: '/api/media/upload',
      method: 'POST',
      body: multipart(boundary, { kind: 'image', alt: 'Portfolio cover' }, {
        name: 'cover.png',
        type: 'image/png',
        bytes: imageBytes,
      }),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-firebase-id-token': token },
    })
    assert.equal(imageUpload.status, 200)
    assert.match(imageUpload.body.data.url, /^\/__local-cms\/uploads\//)
    const imageRead = await callPlugin(middleware, { url: imageUpload.body.data.url })
    assert.equal(imageRead.status, 200)
    assert.deepEqual(imageRead.body, imageBytes)

    const savedWithImage = await callPlugin(middleware, {
      url: `/api/projects/${record.id}`,
      method: 'PUT',
      body: JSON.stringify({
        content: project({
          heroImage: { url: imageUpload.body.data.url, storagePath: imageUpload.body.data.storagePath, caption: '', order: 0 },
        }),
        expectedRevision: record.revision,
      }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    assert.equal(savedWithImage.status, 200)

    const publish = await callPlugin(middleware, {
      url: `/api/projects/${record.id}/publish`,
      method: 'POST',
      body: JSON.stringify({ expectedRevision: savedWithImage.body.data.revision }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    assert.equal(publish.status, 200)
    const publishedAfter = await callPlugin(middleware, { url: '/api/public/projects' })
    assert.equal(publishedAfter.status, 200)
    assert.equal(publishedAfter.body.data[0].title, 'Local disk project')
    assert.equal(publishedAfter.body.data[0].heroImage.url, imageUpload.body.data.url)

    const pdfBoundary = 'local-cms-http-pdf'
    const resumeUpload = await callPlugin(middleware, {
      url: '/api/media/upload',
      method: 'POST',
      body: multipart(pdfBoundary, { kind: 'resume' }, {
        name: 'resume.pdf',
        type: 'application/pdf',
        bytes: validPdf(),
      }),
      headers: { 'content-type': `multipart/form-data; boundary=${pdfBoundary}`, 'x-firebase-id-token': token },
    })
    assert.equal(resumeUpload.status, 200)
    assert.equal(resumeUpload.body.data.status, 'draft')
    const resumePublish = await callPlugin(middleware, {
      url: `/api/resumes/${resumeUpload.body.data.id}/publish`,
      method: 'POST',
      body: JSON.stringify({ expectedRevision: resumeUpload.body.data.revision }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    assert.equal(resumePublish.status, 200)
    const publicResumes = await callPlugin(middleware, { url: '/api/public/resumes' })
    assert.equal(publicResumes.body.data[0].fileName, 'resume.pdf')

    const settings = await callPlugin(middleware, {
      url: '/api/settings?view=drafts',
      headers: { 'x-firebase-id-token': token },
    })
    const savedSettings = await callPlugin(middleware, {
      url: '/api/settings',
      method: 'PUT',
      body: JSON.stringify({
        content: { ...settings.body.data, name: 'Local HTTP Test' },
        expectedRevision: settings.body.data.revision,
      }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    assert.equal(savedSettings.status, 200)
    const settingsPublish = await callPlugin(middleware, {
      url: '/api/settings/publish',
      method: 'POST',
      body: JSON.stringify({ expectedRevision: savedSettings.body.data.revision }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    assert.equal(settingsPublish.status, 200)
    const publicSettings = await callPlugin(middleware, { url: '/api/public/settings' })
    assert.equal(publicSettings.body.data.name, 'Local HTTP Test')

    const unpublish = await callPlugin(middleware, {
      url: `/api/projects/${record.id}/unpublish`,
      method: 'POST',
      headers: { 'x-firebase-id-token': token },
    })
    assert.equal(unpublish.status, 200)
    const publicAfterUnpublish = await callPlugin(middleware, { url: '/api/public/projects' })
    assert.equal(publicAfterUnpublish.body.data.length, 0)

    const experience = await callPlugin(middleware, {
      url: '/api/experiences',
      method: 'POST',
      body: JSON.stringify({
        content: {
          role: 'Product Designer',
          company: 'Local Studio',
          startDate: '2021-01-01',
          endDate: '',
          isCurrent: true,
          description: 'Design systems and product delivery.',
          responsibilities: ['Lead design'],
          achievements: ['Shipped a redesign'],
          skills: ['React', 'Figma'],
          image: { url: '', storagePath: '', caption: '', order: 0 },
          logo: { url: '', storagePath: '', caption: '', order: 0 },
          order: 0,
        },
      }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    assert.equal(experience.status, 201)
    const hiddenExperience = await callPlugin(middleware, { url: '/api/public/experiences' })
    assert.equal(hiddenExperience.body.data.some((item) => item.id === experience.body.data.id), false)

    const coverBoundary = 'local-cms-http-cover-letter'
    const coverUpload = await callPlugin(middleware, {
      url: '/api/media/upload',
      method: 'POST',
      body: multipart(coverBoundary, { kind: 'cover-letter' }, {
        name: 'cover-letter.pdf',
        type: 'application/pdf',
        bytes: validPdf(),
      }),
      headers: { 'content-type': `multipart/form-data; boundary=${coverBoundary}`, 'x-firebase-id-token': token },
    })
    assert.equal(coverUpload.status, 200)
    assert.equal(coverUpload.body.data.fileName, 'cover-letter.pdf')
    assert.match(coverUpload.body.data.fileUrl, /^\/__local-cms\/uploads\//)
    assert.equal(coverUpload.body.data.previewUrl, coverUpload.body.data.fileUrl)
    assert.ok(coverUpload.body.data.storagePath)
    assert.ok(coverUpload.body.data.sizeKB > 0)

    const savedExperience = await callPlugin(middleware, {
      url: `/api/experiences/${experience.body.data.id}`,
      method: 'PUT',
      body: JSON.stringify({
        content: { ...experience.body.data, description: 'Saved background details remain intact.', coverLetter: coverUpload.body.data },
        expectedRevision: experience.body.data.revision,
      }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    assert.equal(savedExperience.status, 200)
    assert.equal(savedExperience.body.data.coverLetter.fileName, 'cover-letter.pdf')
    const stillDraft = await callPlugin(middleware, { url: '/api/public/experiences' })
    assert.equal(stillDraft.body.data.some((item) => item.id === experience.body.data.id), false)

    const experiencePublish = await callPlugin(middleware, {
      url: `/api/experiences/${experience.body.data.id}/publish`,
      method: 'POST',
      body: JSON.stringify({ expectedRevision: savedExperience.body.data.revision }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    assert.equal(experiencePublish.status, 200)
    let publicExperience = await callPlugin(middleware, { url: '/api/public/experiences' })
    let publicEntry = publicExperience.body.data.find((item) => item.id === experience.body.data.id)
    assert.equal(publicEntry.description, 'Saved background details remain intact.')
    assert.equal(publicEntry.coverLetter.fileUrl, coverUpload.body.data.fileUrl)

    const replacementBoundary = 'local-cms-http-cover-letter-replacement'
    const replacementUpload = await callPlugin(middleware, {
      url: '/api/media/upload',
      method: 'POST',
      body: multipart(replacementBoundary, { kind: 'cover-letter' }, {
        name: 'replacement.pdf',
        type: 'application/pdf',
        bytes: validPdf(),
      }),
      headers: { 'content-type': `multipart/form-data; boundary=${replacementBoundary}`, 'x-firebase-id-token': token },
    })
    const replacementDraft = await callPlugin(middleware, {
      url: `/api/experiences/${experience.body.data.id}`,
      method: 'PUT',
      body: JSON.stringify({ content: { ...savedExperience.body.data, coverLetter: replacementUpload.body.data }, expectedRevision: savedExperience.body.data.revision }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    publicExperience = await callPlugin(middleware, { url: '/api/public/experiences' })
    publicEntry = publicExperience.body.data.find((item) => item.id === experience.body.data.id)
    assert.equal(publicEntry.coverLetter.fileUrl, coverUpload.body.data.fileUrl)
    const replacementPublish = await callPlugin(middleware, {
      url: `/api/experiences/${experience.body.data.id}/publish`,
      method: 'POST',
      body: JSON.stringify({ expectedRevision: replacementDraft.body.data.revision }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    assert.equal(replacementPublish.status, 200)
    publicExperience = await callPlugin(middleware, { url: '/api/public/experiences' })
    publicEntry = publicExperience.body.data.find((item) => item.id === experience.body.data.id)
    assert.equal(publicEntry.coverLetter.fileUrl, replacementUpload.body.data.fileUrl)

    const removalDraft = await callPlugin(middleware, {
      url: `/api/experiences/${experience.body.data.id}`,
      method: 'PUT',
      body: JSON.stringify({ content: { ...replacementDraft.body.data, coverLetter: undefined }, expectedRevision: replacementDraft.body.data.revision }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    assert.equal(Object.hasOwn(removalDraft.body.data, 'coverLetter'), false)
    const removalPublish = await callPlugin(middleware, {
      url: `/api/experiences/${experience.body.data.id}/publish`,
      method: 'POST',
      body: JSON.stringify({ expectedRevision: removalDraft.body.data.revision }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    assert.equal(removalPublish.status, 200)
    publicExperience = await callPlugin(middleware, { url: '/api/public/experiences' })
    publicEntry = publicExperience.body.data.find((item) => item.id === experience.body.data.id)
    assert.equal(Object.hasOwn(publicEntry, 'coverLetter'), false)

    const education = await callPlugin(middleware, {
      url: '/api/education',
      method: 'POST',
      body: JSON.stringify({
        content: {
          degree: 'BSc Degree',
          institution: 'Local University',
          fieldOfStudy: 'Computer Science',
          startYear: 2020,
          endYear: 2024,
          notes: 'Honors program',
          credentialUrl: '',
          image: { url: '', storagePath: '', caption: '', order: 0 },
          order: 1,
        },
      }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    assert.equal(education.status, 201)
    const savedEducation = await callPlugin(middleware, {
      url: `/api/education/${education.body.data.id}`,
      method: 'PUT',
      body: JSON.stringify({
        content: { ...education.body.data, degree: 'MSc Degree', notes: 'Saved education draft.' },
        expectedRevision: education.body.data.revision,
      }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    assert.equal(savedEducation.status, 200)
    const reloadedEducation = await callPlugin(middleware, {
      url: `/api/education/${education.body.data.id}?view=drafts`,
      headers: { 'x-firebase-id-token': token },
    })
    assert.equal(reloadedEducation.body.data.notes, 'Saved education draft.')
    assert.equal(reloadedEducation.body.data.fieldOfStudy, 'Computer Science')
    assert.equal(reloadedEducation.body.data.degree, 'MSc Degree')
    const educationPublish = await callPlugin(middleware, {
      url: `/api/education/${education.body.data.id}/publish`,
      method: 'POST',
      body: JSON.stringify({ expectedRevision: savedEducation.body.data.revision }),
      headers: { 'content-type': 'application/json', 'x-firebase-id-token': token },
    })
    assert.equal(educationPublish.status, 200)
    const publicEducation = await callPlugin(middleware, { url: '/api/public/education' })
    assert.equal(publicEducation.body.data[0].fieldOfStudy, 'Computer Science')
    assert.equal(publicEducation.body.data[0].degree, 'MSc Degree')
  })
})
