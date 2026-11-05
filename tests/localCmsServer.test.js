import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLocalCmsStore } from '../dev/localCmsServer.js'
import { profile } from '../src/data/profile.js'
import { toProfileSettings } from '../src/lib/db/presentation.js'
import { publishSkillChanges } from '../src/lib/db/skillPublishing.js'

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
    const socialSettings = {
      ...settings,
      name: 'Local Filesystem Profile',
      socialLinks: {
        email: 'mailto:contact@example.com',
        github: 'https://github.com/fitsum',
        linkedin: 'https://linkedin.com/in/fitsum',
        instagram: 'https://instagram.com/fitsum',
        telegram: 'https://t.me/fitsum',
      },
      socialLinkDisplayOrders: { github: 4, linkedin: 2, instagram: 1, telegram: 3 },
      socialLinkDetails: {
        github: { platform: 'GitHub', enabled: true, logo: null },
        linkedin: { platform: 'LinkedIn', enabled: true, logo: null },
        instagram: { platform: 'Instagram', enabled: true, logo: null },
        telegram: { platform: 'Telegram', enabled: true, logo: null },
      },
      customSocialLinks: [{
        id: 'custom-dribbble',
        platform: 'Dribbble',
        url: 'https://dribbble.com/fitsum',
        logo: { url: 'https://cdn.example.com/dribbble.png', storagePath: '' },
        displayOrder: 5,
      }],
      seo: { metaTitle: 'Portfolio SEO title', metaDescription: 'Portfolio SEO description' },
    }
    const savedSettings = await store.saveSettings(socialSettings, settings.revision)
    assert.equal((await store.publishedSettings()).name, settings.name)
    await store.publishSettings(savedSettings.revision)
    const publishedSocialSettings = await store.publishedSettings()
    assert.equal(publishedSocialSettings.name, 'Local Filesystem Profile')
    assert.deepEqual(toProfileSettings(publishedSocialSettings, profile).socials.map(({ id }) => id), [
      'email', 'instagram', 'linkedin', 'telegram', 'github', 'custom-dribbble',
    ])

    store = createLocalCmsStore(directory)
    assert.equal((await store.get('projects', updated.id, 'published')).title, 'Edited disk project')
    const reloadedSettings = await store.getSettings('published')
    assert.equal(reloadedSettings.name, 'Local Filesystem Profile')
    assert.equal(toProfileSettings(reloadedSettings, profile).socials.find(({ id }) => id === 'custom-dribbble').url, 'https://dribbble.com/fitsum')

    const emptySettings = await store.saveSettings({
      ...reloadedSettings,
      socialLinks: { email: reloadedSettings.socialLinks.email },
      socialLinkDetails: {},
      socialLinkDisplayOrders: {},
      customSocialLinks: [],
    }, reloadedSettings.revision)
    assert.equal((await store.publishedSettings()).customSocialLinks.length, 1)
    await store.publishSettings(emptySettings.revision)

    store = createLocalCmsStore(directory)
    const reloadedEmptySettings = await store.getSettings('published')
    assert.deepEqual(reloadedEmptySettings.socialLinks, { email: 'mailto:contact@example.com' })
    assert.deepEqual(reloadedEmptySettings.customSocialLinks, [])
    assert.deepEqual(toProfileSettings(reloadedEmptySettings, profile).socials.map(({ id }) => id), ['email'])
    assert.deepEqual(reloadedEmptySettings.seo, { metaTitle: 'Portfolio SEO title', metaDescription: 'Portfolio SEO description' })

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

test('local skills and tools persist through draft, publish, and logo replacement', async () => {
  await withStore(async (directory) => {
    const store = createLocalCmsStore(directory)
    const catalog = await store.create('media', {
      type: 'image',
      isSkillCatalog: true,
      url: '',
      storagePath: '',
      sizeBytes: 0,
    })
    const skill = await store.create('media', {
      type: 'image',
      isSkill: true,
      name: 'JavaScript',
      category: 'Frontend',
      url: 'https://cdn.example.com/javascript.svg',
      storagePath: '',
      sizeBytes: 0,
      order: 0,
    })
    assert.equal((await store.publishedRecords('media')).some((item) => item.isSkill), false)
    await store.publish('media', skill.id, skill.revision)
    await store.publish('media', catalog.id, catalog.revision)
    assert.equal((await store.publishedDocument('media', skill.id)).name, 'JavaScript')

    const replacement = await store.upload({
      bytes: imageBytes,
      fileName: 'javascript.png',
      mimeType: 'image/png',
      kind: 'image',
      replaceMediaId: skill.id,
    })
    assert.equal(replacement.isSkill, true)
    assert.equal(replacement.name, 'JavaScript')
    assert.equal(replacement.category, 'Frontend')
    assert.equal(replacement.url.startsWith('/__local-cms/uploads/'), true)
  })
})

test('skill deletion stays private as a draft and publishing removes it without publishing its logo', async () => {
  await withStore(async (directory) => {
    const store = createLocalCmsStore(directory)
    const catalog = await store.create('media', {
      type: 'image',
      isSkillCatalog: true,
      url: '',
      storagePath: '',
      sizeBytes: 0,
    })
    const createSkill = (name, order) => store.create('media', {
      type: 'image',
      isSkill: true,
      name,
      category: 'Frontend',
      url: `https://cdn.example.com/${name.toLowerCase()}.svg`,
      storagePath: '',
      sizeBytes: 0,
      order,
    })
    const removed = await createSkill('React', 0)
    const alsoRemoved = await createSkill('HTML', 1)
    const edited = await createSkill('TypeScript', 1)
    const unaffected = await createSkill('CSS', 3)
    await store.publish('media', removed.id, removed.revision)
    await store.publish('media', alsoRemoved.id, alsoRemoved.revision)
    await store.publish('media', edited.id, edited.revision)
    await store.publish('media', unaffected.id, unaffected.revision)
    await store.publish('media', catalog.id, catalog.revision)

    const deletionDraft = await store.save('media', removed.id, {
      ...removed,
      visibility: false,
      pendingDelete: true,
    }, removed.revision)
    assert.deepEqual(
      (await store.publishedRecords('media')).filter((item) => item.isSkill).map((item) => item.name),
      ['React', 'HTML', 'TypeScript', 'CSS'],
    )
    const secondDeletionDraft = await store.save('media', alsoRemoved.id, {
      ...alsoRemoved,
      visibility: false,
      pendingDelete: true,
    }, alsoRemoved.revision)

    const editedDraft = await store.save('media', edited.id, {
      ...edited,
      name: 'TypeScript 5',
    }, edited.revision)
    const added = await createSkill('Vite', 3)
    const savedItems = [
      { ...deletionDraft, pendingDelete: true },
      { ...secondDeletionDraft, pendingDelete: true },
      editedDraft,
      added,
      unaffected,
    ]

    const publishedIds = []
    await publishSkillChanges({
      publish: async (...args) => {
        publishedIds.push(args[1])
        return store.publish(...args)
      },
      deleteItem: (...args) => store.deleteItem(...args),
    }, savedItems, catalog)

    assert.deepEqual(publishedIds, [edited.id, added.id, unaffected.id, catalog.id])
    const publishedSkills = (await store.publishedRecords('media'))
      .filter((item) => item.isSkill)
      .map((item) => item.name)
    assert.deepEqual(publishedSkills, ['TypeScript 5', 'CSS', 'Vite'])

    const restarted = createLocalCmsStore(directory)
    assert.deepEqual(
      (await restarted.publishedRecords('media')).filter((item) => item.isSkill).map((item) => item.name),
      publishedSkills,
    )
  })
})

test('local education and experience documents persist through draft and publish lifecycles', async () => {
  await withStore(async (directory) => {
    const store = createLocalCmsStore(directory)
    const credential = await store.upload({ bytes: imageBytes, fileName: 'credential.png', mimeType: 'image/png' })
    const recommendation = await store.upload({ bytes: imageBytes, fileName: 'recommendation.png', mimeType: 'image/png' })
    const education = await store.create('education', {
      degree: 'Other',
      customDegree: 'Advanced Certificate',
      institution: 'Local University',
      startYear: 2020,
      credentialImage: { url: credential.url, storagePath: credential.storagePath },
    })
    const experience = await store.create('experiences', {
      role: 'Engineer',
      company: 'Local Studio',
      startDate: '2022-01-01',
      isCurrent: true,
      skills: ['React'],
      recommendationLetter: { url: recommendation.url, storagePath: recommendation.storagePath },
      recommendationLetterUrl: 'https://example.test/recommendation',
    })
    assert.equal((await store.get('education', education.id)).credentialImage.storagePath, credential.storagePath)
    assert.equal((await store.get('experiences', experience.id)).recommendationLetter.storagePath, recommendation.storagePath)
    await store.publish('education', education.id, education.revision)
    await store.publish('experiences', experience.id, experience.revision)
    assert.equal((await store.get('education', education.id, 'published')).customDegree, 'Advanced Certificate')
    assert.equal((await store.get('experiences', experience.id, 'published')).recommendationLetterUrl, 'https://example.test/recommendation')

    await assert.rejects(store.deleteItem('media', credential.id), /still used/)
    const updatedEducation = await store.save('education', education.id, {
      ...education,
      credentialImage: null,
    }, education.revision)
    await assert.rejects(store.deleteItem('media', credential.id), /still used/)
    await store.publish('education', education.id, updatedEducation.revision)
    await store.deleteItem('media', credential.id)
    assert.equal(await store.serveUpload(credential.storagePath), null)
    assert.deepEqual((await store.serveUpload(recommendation.storagePath)).contents, imageBytes)
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
