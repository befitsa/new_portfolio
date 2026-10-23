import test from 'node:test'
import assert from 'node:assert/strict'
import { toProfileSettings } from '../src/lib/db/presentation.js'
import { profile } from '../src/data/profile.js'
import { createDefaultContentState } from '../src/data/defaultContent.js'
import { isValidPdfDocument } from '../src/lib/db/pdfValidation.js'

const CONTENT_KEY = 'fitsum-portfolio-content-v2'
const LEGACY_KEY = 'fitsum-portfolio-cms-local-demo-v1'

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

function setLocalStorage(value) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value })
}

function validPdfText() {
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
  return text
}

function project(overrides = {}) {
  return {
    title: 'Local test project',
    slug: 'local-test-project',
    category: 'Web',
    synopsis: 'A project created in the local CMS test.',
    heroImage: { url: '', storagePath: '', caption: '', order: 0 },
    gallery: [],
    ...overrides,
  }
}

test('local content service initializes, migrates, edits, publishes, and removes content', async () => {
  const storage = new MemoryStorage()
  setLocalStorage(storage)
  let moduleNumber = 0
  const loadService = () => import(`../src/services/contentService.js?content-test=${moduleNumber++}`)

  let serviceModule = await loadService()
  const service = serviceModule.contentService
  const health = await service.health()
  assert.equal(health.ok, true)
  assert.equal(health.mode, 'local-browser-storage')
  assert.equal((await service.list('projects', 'published')).length, 0)
  assert.equal((await service.list('education', 'published')).length, 0)
  assert.equal((await service.list('experiences', 'published')).length, 0)

  const webProject = await service.create('projects', project({ title: 'Web category project', slug: 'web-category-project', category: 'Web' }))
  await service.publish('projects', webProject.id, webProject.revision)
  assert.equal((await service.list('projects', 'published')).find((item) => item.id === webProject.id).category, 'Web')

  const created = await service.create('projects', project({ category: 'Mobile' }))
  assert.equal(created.status, 'draft')
  assert.equal((await service.list('projects', 'published')).some((item) => item.id === created.id), false)
  const publishedOnce = await service.publish('projects', created.id, created.revision)
  assert.equal(publishedOnce.mode, 'local-browser')
  assert.equal((await service.get('projects', created.id, 'published')).category, 'Mobile')

  const edited = await service.save('projects', created.id, project({
    title: 'Edited local project',
    slug: 'edited-local-project',
    category: 'UI/UX',
  }), created.revision)
  assert.equal(edited.revision, 2)
  assert.equal((await service.get('projects', created.id, 'published')).title, 'Local test project')
  await service.publish('projects', created.id, edited.revision)
  assert.equal((await service.get('projects', created.id, 'published')).title, 'Edited local project')
  assert.equal((await service.get('projects', created.id, 'published')).category, 'UI/UX')
  await assert.rejects(service.create('projects', project({ category: 'SaaS & Cloud' })))

  const education = await service.create('education', {
    degree: 'BSc', institution: 'Local University', startYear: 2020, endYear: 2024, credentialUrl: 'https://example.com/credential',
  })
  const experience = await service.create('experiences', {
    role: 'Engineer', company: 'Local Studio', startDate: '2022-01-01', endDate: '', isCurrent: true,
  })
  const earlierExperience = await service.create('experiences', {
    role: 'Developer', company: 'Earlier Studio', startDate: '2020-01-01', endDate: '2021-12-31', order: 1,
  })
  await service.publish('education', education.id, education.revision)
  await service.publish('experiences', experience.id, experience.revision)
  await service.publish('experiences', earlierExperience.id, earlierExperience.revision)
  assert.equal((await service.list('education', 'published')).some((item) => item.id === education.id), true)
  assert.equal((await service.list('experiences', 'published')).some((item) => item.id === experience.id), true)
  assert.equal((await service.list('education', 'published')).some((item) => item.id === experience.id), false)
  assert.equal((await service.list('experiences', 'published')).some((item) => item.id === education.id), false)

  const editedEducation = await service.save('education', education.id, {
    degree: 'BSc Computer Science', institution: 'Local University', startYear: 2020, endYear: 2024, credentialUrl: 'https://example.com/credential',
  }, education.revision)
  await service.publish('education', education.id, editedEducation.revision)
  const orderedExperience = await service.reorder('experiences', [
    { id: earlierExperience.id, expectedRevision: earlierExperience.revision, order: 0 },
    { id: experience.id, expectedRevision: experience.revision, order: 1 },
  ])
  for (const item of orderedExperience) await service.publish('experiences', item.id, item.revision)
  assert.deepEqual((await service.list('experiences', 'published')).map((item) => item.id), [earlierExperience.id, experience.id])
  assert.equal((await service.get('education', education.id, 'published')).degree, 'BSc Computer Science')
  assert.equal((await service.get('education', education.id, 'published')).credentialUrl, 'https://example.com/credential')
  await service.unpublish('experiences', experience.id)
  assert.equal((await service.get('experiences', experience.id, 'published')).status, 'unpublished')
  assert.equal((await service.get('experiences', experience.id, 'published')).visibility, false)
  const reorderedCurrentExperience = orderedExperience.find((item) => item.id === experience.id)
  await service.publish('experiences', experience.id, reorderedCurrentExperience.revision)
  assert.equal((await service.get('experiences', experience.id, 'published')).company, 'Local Studio')

  const settings = await service.getSettings()
  const updatedSettings = await service.saveSettings({ ...settings, name: 'Fitsum Local Test', about: 'An updated public About section.' }, settings.revision)
  await service.publishSettings(updatedSettings.revision)
  const publicSettings = await service.getSettings('published')
  assert.equal(publicSettings.name, 'Fitsum Local Test')
  assert.equal(toProfileSettings(publicSettings, profile).about, 'An updated public About section.')

  const media = await service.importImage('https://example.com/portfolio-cover.webp', 'Cover')
  const referencedProject = await service.create('projects', project({
    title: 'Project with referenced media',
    slug: 'project-with-referenced-media',
    heroImage: { url: media.url, storagePath: media.storagePath, caption: 'Cover', order: 0 },
  }))
  await service.publish('projects', referencedProject.id, referencedProject.revision)
  const listedMedia = await service.list('media', 'published')
  assert.deepEqual(listedMedia.find((item) => item.id === media.id).usedIn, ['Project with referenced media'])
  await assert.rejects(service.removeMedia(media.id), /still used by Project with referenced media/)

  await service.unpublish('projects', created.id)
  assert.equal((await service.list('projects', 'published')).some((item) => item.id === created.id && item.status === 'published'), false)
  await service.deleteItem('projects', referencedProject.id)
  assert.equal((await service.list('projects', 'published')).some((item) => item.id === referencedProject.id && item.status === 'published'), false)
  await service.removeMedia(media.id)
  await service.deleteItem('education', education.id)
  assert.equal((await service.list('education', 'published')).some((item) => item.id === education.id && item.status === 'published'), false)
  assert.equal((await service.list('experiences', 'published')).some((item) => item.id === experience.id && item.status === 'published'), true)
  await service.deleteItem('experiences', experience.id)
  assert.equal((await service.list('experiences', 'published')).some((item) => item.id === experience.id && item.status === 'published'), false)
  assert.equal((await service.list('experiences', 'published')).some((item) => item.id === earlierExperience.id && item.status === 'published'), true)

  const badPdf = new Blob(['%PDF-1.7\nnot a valid PDF'], { type: 'application/pdf' })
  assert.equal(isValidPdfDocument(new Uint8Array(await badPdf.arrayBuffer())), false)
  await assert.rejects(service.upload(badPdf, { kind: 'resume' }), /not a valid PDF/)
  const validPdf = new Blob([validPdfText()], { type: 'application/pdf' })
  assert.equal(isValidPdfDocument(new Uint8Array(await validPdf.arrayBuffer())), true)
  Object.defineProperty(validPdf, 'name', { value: 'local-resume.pdf' })
  await assert.rejects(service.upload(validPdf, { kind: 'resume' }), /IndexedDB/)

  const seededState = createDefaultContentState()
  for (let index = 1; index <= 12; index += 1) {
    const id = `project-${String(index).padStart(2, '0')}`
    const suffix = String(index).padStart(2, '0')
    seededState.published.projects.push({ ...project({ title: `Project slot ${suffix}`, slug: `project-slot-${suffix}`, category: 'Web Design' }), id, status: 'published', revision: 1, publishedRevision: 1, visibility: true, order: index })
  }
  for (const [id, degree, institution, startYear, endYear] of [
    ['edu-hawassa', 'Computer Science (BSc)', 'Hawassa University', 2019, 2024],
    ['edu-udacity', 'Fundamental Programming', 'Udacity', 2024, 2024],
    ['edu-hackerrank', 'Frontend Developer (React)', 'HackerRank', 2024, 2024],
  ]) seededState.published.education.push({ id, degree, institution, startYear, endYear, notes: '', credentialUrl: '', visibility: true, order: 0, status: 'published', revision: 1, publishedRevision: 1 })
  storage.setItem(CONTENT_KEY, JSON.stringify(seededState))
  serviceModule = await loadService()
  const cleanupHealth = await serviceModule.contentService.health()
  assert.match(cleanupHealth.recoveryNotice, /Removed 15 built-in/)
  assert.equal((await serviceModule.contentService.list('projects', 'published')).length, 0)
  assert.equal((await serviceModule.contentService.list('education', 'published')).length, 0)

  const legacyDemo = { ...project({ title: 'Legacy demo project', slug: 'legacy-demo-project' }), id: 'demo-migrated-project', category: 'SaaS & Cloud', status: 'published', revision: 1, publishedRevision: 1, heroImage: { url: 'blob:old-preview', storagePath: 'local-assets/lost-file', caption: '', order: 0 } }
  storage.removeItem(CONTENT_KEY)
  storage.setItem(LEGACY_KEY, JSON.stringify({
    published: { projects: [legacyDemo], experiences: [], education: [], resumes: [], media: [] },
    drafts: { projects: [], experiences: [], education: [], resumes: [], media: [] },
  }))
  serviceModule = await loadService()
  await serviceModule.contentService.health()
  const migrated = await serviceModule.contentService.get('projects', 'demo-migrated-project')
  assert.equal(migrated.status, 'draft')
  assert.equal(migrated.category, 'Web')
  assert.equal(migrated.heroImage.url, '')
  assert.equal(migrated.heroImage.storagePath, '')

  storage.removeItem(LEGACY_KEY)
  storage.setItem(CONTENT_KEY, '{invalid json')
  serviceModule = await loadService()
  const recovery = await serviceModule.contentService.health()
  assert.match(recovery.recoveryNotice, /corrupted/i)
  assert.equal((await serviceModule.contentService.list('projects', 'published')).length, 0)

  setLocalStorage({ getItem() { throw new Error('storage denied') }, setItem() { throw new Error('storage denied') } })
  serviceModule = await loadService()
  await assert.rejects(serviceModule.contentService.health(), /Browser storage is unavailable/)
})
