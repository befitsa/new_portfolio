import test from 'node:test'
import assert from 'node:assert/strict'
import {
  educationSchema,
  experienceSchema,
  mediaSchema,
  projectSchema,
  resumeSchema,
  siteSettingsSchema,
} from '../src/lib/db/contentSchemas.js'
import { toPublicEducation, toPublicExperience } from '../src/lib/db/presentation.js'

test('project schema applies safe defaults and limits synopsis length', () => {
  const project = projectSchema.parse({
    title: '  Portfolio CMS ',
    slug: 'portfolio-cms',
    synopsis: 'A content workflow',
  })
  assert.equal(project.title, 'Portfolio CMS')
  assert.equal(project.visibility, true)
  assert.deepEqual(project.links, { github: '', figma: '', live: '' })
  assert.equal(projectSchema.safeParse({
    title: 'x',
    slug: 'invalid slug',
    synopsis: 'x'.repeat(201),
  }).success, false)
})

test('project categories use the public filter labels and local image paths stay same-site', () => {
  const project = projectSchema.parse({
    title: 'Existing site image',
    slug: 'existing-site-image',
    category: 'UI/UX',
    heroImage: { url: '/images/projects/example.webp' },
  })
  assert.equal(project.category, 'UI/UX')
  assert.equal(projectSchema.parse({ title: 'Legacy web', slug: 'legacy-web', category: 'Web Design' }).category, 'Web')
  assert.equal(projectSchema.parse({ title: 'Legacy mobile', slug: 'legacy-mobile', category: 'Mobile App' }).category, 'Mobile')
  assert.equal(project.heroImage.url, '/images/projects/example.webp')
  assert.equal(projectSchema.safeParse({ title: 'Custom category', slug: 'custom-category', category: 'SaaS & Cloud' }).success, false)
  assert.equal(projectSchema.safeParse({ title: 'Remote path', slug: 'remote-path', heroImage: { url: '//outside.example/image.webp' } }).success, false)
})

test('experience schema validates dates and current role rules', () => {
  const base = {
    role: 'Engineer',
    company: 'Example',
    startDate: '2023-01-01',
    isCurrent: false,
    endDate: '2022-01-01',
  }
  assert.equal(experienceSchema.safeParse(base).success, false)
  assert.equal(experienceSchema.safeParse({ ...base, endDate: '', isCurrent: true }).success, true)
  assert.equal(experienceSchema.safeParse({ ...base, isCurrent: true }).success, false)
})

test('education schema rejects an end year before the start year', () => {
  assert.equal(educationSchema.safeParse({
    degree: 'BSc',
    institution: 'Example University',
    startYear: 2022,
    endYear: 2021,
  }).success, false)
  assert.equal(educationSchema.safeParse({
    degree: 'Certificate', institution: 'Example', startYear: 2024, endYear: 2024,
    credentialUrl: 'https://example.com/certificate',
  }).success, true)
  assert.equal(educationSchema.safeParse({
    degree: 'Certificate', institution: 'Example', startYear: 2024, credentialUrl: 'javascript:alert(1)',
  }).success, false)
})

test('background document fields are optional, validated, and backward compatible', () => {
  const education = {
    degree: 'BSc Degree',
    institution: 'Example University',
    startYear: 2020,
  }
  const image = { url: 'https://storage.example/signed-image', storagePath: 'portfolio-private/drafts/user/certificate.png' }
  assert.equal(educationSchema.parse(education).credentialImage, null)
  assert.equal(educationSchema.parse({ ...education, credentialImage: image }).credentialImage.storagePath, image.storagePath)
  assert.equal(educationSchema.parse({ ...education, credentialUrl: 'https://example.test/credential' }).credentialUrl, 'https://example.test/credential')
  assert.equal(educationSchema.safeParse({ ...education, credentialUrl: 'javascript:alert(1)' }).success, false)
  assert.equal(educationSchema.safeParse({ ...education, degree: 'Other' }).success, false)
  assert.equal(educationSchema.parse({ ...education, degree: 'Other', customDegree: 'Advanced Certificate' }).customDegree, 'Advanced Certificate')

  const experience = {
    role: 'Engineer',
    company: 'Example',
    startDate: '2024-01-01',
  }
  assert.equal(experienceSchema.parse(experience).recommendationLetter, null)
  assert.equal(experienceSchema.parse({ ...experience, recommendationLetter: image }).recommendationLetter.storagePath, image.storagePath)
  assert.equal(experienceSchema.parse({ ...experience, recommendationLetterUrl: 'https://example.test/recommendation' }).recommendationLetterUrl, 'https://example.test/recommendation')
  assert.equal(experienceSchema.safeParse({ ...experience, recommendationLetterUrl: 'javascript:alert(1)' }).success, false)
})

test('public background projections include only saved document destinations', () => {
  const education = toPublicEducation({
    id: 'education-1',
    degree: 'Other',
    customDegree: 'Advanced Certificate',
    institution: 'Example University',
    startYear: 2020,
    credentialImage: { url: 'https://storage.example/public-certificate.png' },
    credentialUrl: 'https://example.test/credential',
  })
  assert.equal(education.title, 'Advanced Certificate')
  assert.equal(education.credentialImageUrl, 'https://storage.example/public-certificate.png')
  assert.equal(education.credentialUrl, 'https://example.test/credential')

  const experience = toPublicExperience({
    id: 'experience-1',
    role: 'Engineer',
    company: 'Example',
    startDate: '2024-01-01',
    recommendationLetter: { url: 'https://storage.example/public-letter.png' },
    recommendationLetterUrl: 'https://example.test/recommendation',
  })
  assert.equal(experience.recommendationLetterImageUrl, 'https://storage.example/public-letter.png')
  assert.equal(experience.recommendationLetterUrl, 'https://example.test/recommendation')
  assert.equal(toPublicEducation({ degree: 'BSc Degree', startYear: 2020 }).credentialImageUrl, '')
  assert.equal(toPublicExperience({ role: 'Engineer', startDate: '2024-01-01' }).recommendationLetterImageUrl, '')
})

test('resume, media, and settings schemas reject invalid external data', () => {
  assert.equal(resumeSchema.safeParse({
    fileUrl: 'javascript:alert(1)',
    storagePath: 'drafts/resume/file.pdf',
    fileName: 'file.pdf',
    sizeKB: 100,
    version: '1',
  }).success, false)
  assert.equal(mediaSchema.safeParse({
    url: 'not-a-url',
    storagePath: 'drafts/media/image.png',
    type: 'image',
    sizeBytes: 1024,
  }).success, false)
  assert.equal(siteSettingsSchema.safeParse({
    name: 'Fitsum',
    socialLinks: { github: 'javascript:alert(1)' },
  }).success, false)
  assert.equal(siteSettingsSchema.safeParse({
    name: 'Fitsum',
    socialLinks: { email: 'mailto:Fitsum@example.com', github: 'https://github.com/fitsum' },
  }).success, true)
  assert.equal(siteSettingsSchema.safeParse({
    name: 'Fitsum',
    socialLinks: { github: 'mailto:Fitsum@example.com' },
  }).success, false)
})
