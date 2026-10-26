import test from 'node:test'
import assert from 'node:assert/strict'
import {
  educationSchema,
  experienceSchema,
  projectSchema,
  resumeSchema,
  siteSettingsSchema,
} from '../src/lib/db/contentSchemas.js'
import { toPublicEducation, toPublicExperience, toPublicProject } from '../src/lib/db/presentation.js'

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

test('project thumbnail and case study cover are published independently', () => {
  const project = toPublicProject({
    id: 'portfolio-project',
    title: 'Portfolio project',
    slug: 'portfolio-project',
    category: 'Web',
    thumbnailImage: { url: 'https://res.cloudinary.com/demo/image/upload/thumb.webp' },
    heroImage: { url: 'https://res.cloudinary.com/demo/image/upload/cover.webp' },
  })
  assert.equal(project.image, 'https://res.cloudinary.com/demo/image/upload/thumb.webp')
  assert.equal(project.coverImage, 'https://res.cloudinary.com/demo/image/upload/cover.webp')
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
  const experience = experienceSchema.parse({
    role: 'Engineer', company: 'Example', startDate: '2023-01-01', isCurrent: true,
    image: { url: 'https://res.cloudinary.com/demo/image/upload/experience.webp', storagePath: 'portfolio/admin/experience-image-id', mediaProvider: 'cloudinary' },
  })
  assert.equal(toPublicExperience(experience).image, 'https://res.cloudinary.com/demo/image/upload/experience.webp')
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
  const education = educationSchema.parse({
    degree: 'BSc',
    institution: 'Example University',
    fieldOfStudy: 'Computer Science',
    startYear: 2020,
    endYear: 2024,
    notes: 'Graduated with honors.',
    image: { url: 'https://res.cloudinary.com/demo/image/upload/education.webp', storagePath: 'portfolio/admin/education-image-id', mediaProvider: 'cloudinary' },
  })
  const publicEducation = toPublicEducation({ id: 'education-record', ...education })
  assert.equal(publicEducation.place, 'Example University · Computer Science')
  assert.equal(publicEducation.description, 'Graduated with honors.')
  assert.equal(publicEducation.image, 'https://res.cloudinary.com/demo/image/upload/education.webp')
})

test('resume and settings schemas reject invalid external data', () => {
  assert.equal(resumeSchema.safeParse({
    fileUrl: 'javascript:alert(1)',
    storagePath: 'drafts/resume/file.pdf',
    fileName: 'file.pdf',
    sizeKB: 100,
    version: '1',
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

test('Cloudflare R2 media references accept same-site signed URLs and keep storage keys', () => {
  const project = projectSchema.parse({
    title: 'Stored project',
    slug: 'stored-project',
    thumbnailImage: {
      url: '/api/media?key=portfolio%2Fadmin%2F12345678-1234-1234-1234-123456789abc&expires=123&sig=signature',
      storagePath: 'portfolio/admin/12345678-1234-1234-1234-123456789abc',
      mediaProvider: 'cloudflare-r2',
      format: 'webp',
    },
  })
  const resume = resumeSchema.parse({
    fileUrl: '/api/media?key=portfolio%2Fadmin%2F12345678-1234-1234-1234-123456789abc&expires=123&sig=signature',
    previewUrl: '/api/media?key=portfolio%2Fadmin%2F12345678-1234-1234-1234-123456789abc&expires=123&sig=signature',
    storagePath: 'portfolio/admin/12345678-1234-1234-1234-123456789abc',
    mediaProvider: 'cloudflare-r2',
    fileName: 'resume.pdf',
    sizeKB: 5120,
    version: '1',
  })

  assert.equal(project.thumbnailImage.mediaProvider, 'cloudflare-r2')
  assert.equal(resume.mediaProvider, 'cloudflare-r2')
  assert.equal(resume.storagePath, project.thumbnailImage.storagePath)
})
