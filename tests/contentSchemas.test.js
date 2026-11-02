import test from 'node:test'
import assert from 'node:assert/strict'
import {
  educationSchema,
  experienceSchema,
  mediaSchema,
  normalizeSkills,
  projectSchema,
  resumeSchema,
  siteSettingsSchema,
} from '../src/lib/db/contentSchemas.js'
import { toProfileSettings, toPublicEducation, toPublicExperience, toPublicProject } from '../src/lib/db/presentation.js'
import { skillBadgeColor, skillBadgeColors } from '../src/lib/db/skillBadges.js'

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

test('project technologies support structured entries and normalize legacy comma-separated values', () => {
  const project = projectSchema.parse({
    title: 'Technology records',
    slug: 'technology-records',
    techStack: [
      { id: 'react', name: 'React', logo: { url: 'https://storage.example/react.svg', storagePath: 'portfolio-private/drafts/react.svg' }, description: 'Reusable interfaces.' },
      { id: 'figma', name: 'Figma', description: 'Prototyping.' },
    ],
  })
  assert.equal(project.techStack[0].logo.storagePath, 'portfolio-private/drafts/react.svg')
  assert.equal(project.techStack[0].description, 'Reusable interfaces.')
  assert.deepEqual(projectSchema.parse({
    title: 'Legacy stack',
    slug: 'legacy-stack',
    techStack: 'React, JavaScript, Firebase',
  }).techStack.map(({ name }) => name), ['React', 'JavaScript', 'Firebase'])
  assert.deepEqual(projectSchema.parse({
    title: 'Legacy technology field',
    slug: 'legacy-technology-field',
    techStack: ['React', 'Vite'],
  }).techStack.map(({ name }) => name), ['React', 'Vite'])
})

test('public project projection keeps structured technology logos and handles legacy strings', () => {
  const structured = toPublicProject({
    id: 'project-1', slug: 'project-1', title: 'Project', techStack: [
      { id: 'react', name: 'React', logo: { url: 'https://storage.example/react.svg', storagePath: 'portfolio-published/react.svg' }, description: 'UI components.' },
    ],
  })
  assert.equal(structured.tech[0].logo.url, 'https://storage.example/react.svg')
  assert.equal(structured.tech[0].description, 'UI components.')
  const legacy = toPublicProject({
    id: 'project-2', slug: 'project-2', title: 'Legacy', technologies: 'React, JavaScript',
  })
  assert.deepEqual(legacy.tech.map(({ name }) => name), ['React', 'JavaScript'])
  assert.equal(legacy.tech[0].logo.url, '')
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

test('experience skills normalize legacy strings and de-duplicate arrays without losing valid entries', () => {
  const skills = [' IT Support ', 'Network Administration', 'IT support', '', '  ']
  assert.deepEqual(normalizeSkills(skills), ['IT Support', 'Network Administration'])
  assert.deepEqual(normalizeSkills(' IT Support, Network Administration, IT support, , '), ['IT Support', 'Network Administration'])
  assert.deepEqual(experienceSchema.parse({
    role: 'Engineer',
    company: 'Example',
    startDate: '2024-01-01',
    skills: 'IT Support, Network Administration',
  }).skills, ['IT Support', 'Network Administration'])
  assert.deepEqual(experienceSchema.parse({
    role: 'Engineer',
    company: 'Example',
    startDate: '2024-01-01',
    description: 'Updated description only',
    skills: ['Windows Server', 'Database Management'],
  }).skills, ['Windows Server', 'Database Management'])
  assert.deepEqual(experienceSchema.parse({
    role: 'Engineer',
    company: 'Example',
    startDate: '2024-01-01',
    skills: '',
  }).skills, [])
})

test('public experience projection retains legacy skills and badge colors are stable and varied', () => {
  const experience = toPublicExperience({
    id: 'experience-1',
    role: 'Engineer',
    startDate: '2024-01-01',
    skills: 'IT Support, Network Administration, Windows Server',
  })
  assert.deepEqual(experience.skills, ['IT Support', 'Network Administration', 'Windows Server'])
  assert.equal(skillBadgeColor(0), skillBadgeColor(0))
  assert.notEqual(skillBadgeColor(0), skillBadgeColor(1))
  assert.equal(skillBadgeColor(skillBadgeColors.length), skillBadgeColor(0))
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

test('social settings support legacy links, safe custom links, and durable uploaded logos', () => {
  const legacy = siteSettingsSchema.parse({
    name: 'Fitsum',
    socialLinks: { github: 'https://github.com/fitsum', linkedin: 'https://linkedin.com/in/fitsum' },
  })
  assert.deepEqual(legacy.customSocialLinks, [])
  assert.equal(legacy.visibility, true)

  const settings = siteSettingsSchema.parse({
    name: 'Fitsum',
    socialLinks: {
      github: 'https://github.com/fitsum',
      instagram: 'https://instagram.com/fitsum',
      telegram: 'https://t.me/fitsum',
    },
    customSocialLinks: [{
      id: 'custom-facebook',
      platform: ' Facebook ',
      url: 'https://facebook.com/fitsum',
      displayOrder: 5,
      logo: {
        url: 'https://signed.example/logo.webp',
        storagePath: 'portfolio-private/drafts/admin/logo.webp',
      },
    }],
    socialLinkDisplayOrders: { github: 1, instagram: 2, linkedin: 3, telegram: 4 },
  })
  assert.equal(settings.customSocialLinks[0].platform, 'Facebook')
  assert.equal(settings.customSocialLinks[0].displayOrder, 5)
  assert.equal(settings.customSocialLinks[0].logo.storagePath, 'portfolio-private/drafts/admin/logo.webp')
  assert.equal(siteSettingsSchema.safeParse({
    name: 'Fitsum',
    socialLinkDisplayOrders: { github: 0 },
  }).success, false)
  assert.equal(siteSettingsSchema.safeParse({
    name: 'Fitsum',
    customSocialLinks: [{ id: 'custom-x', platform: 'X', url: 'https://x.com/one', displayOrder: 1.5 }],
  }).success, false)
  assert.equal(siteSettingsSchema.safeParse({
    name: 'Fitsum',
    customSocialLinks: [{ id: 'custom-x', platform: 'X', url: 'javascript:alert(1)' }],
  }).success, false)
  assert.equal(siteSettingsSchema.safeParse({
    name: 'Fitsum',
    customSocialLinks: [
      { id: 'custom-x', platform: 'X', url: 'https://x.com/one' },
      { id: 'custom-x', platform: 'X', url: 'https://x.com/two' },
    ],
  }).success, false)

  const profile = toProfileSettings({
    ...settings,
    customSocialLinks: [
      ...settings.customSocialLinks,
      { id: 'custom-unsafe', platform: 'Unsafe', url: 'javascript:alert(1)' },
    ],
  }, { name: 'Fallback', socials: [], email: 'fallback@example.com' })
  assert.equal(profile.socials.some(({ id }) => id === 'instagram'), true)
  assert.equal(profile.socials.some(({ id }) => id === 'telegram'), true)
  assert.equal(profile.socials.find(({ id }) => id === 'custom-facebook').logo.url, 'https://signed.example/logo.webp')
  assert.equal(profile.socials.some(({ id }) => id === 'custom-unsafe'), false)
})

test('public social settings sort all platforms by saved display order with stable legacy fallbacks', () => {
  const customSocialLinks = [
    { id: 'custom-facebook', platform: 'Facebook', url: 'https://facebook.com/fitsum', displayOrder: 2 },
    { id: 'custom-youtube', platform: 'YouTube', url: 'https://youtube.com/@fitsum', displayOrder: 2 },
  ]
  const sourceSettings = {
    name: 'Fitsum',
    socialLinks: {
      github: 'https://github.com/fitsum',
      linkedin: 'https://linkedin.com/in/fitsum',
      instagram: 'https://instagram.com/fitsum',
      telegram: 'https://t.me/fitsum',
    },
    socialLinkDisplayOrders: { github: 3, linkedin: 1, instagram: 2, telegram: 8 },
    customSocialLinks,
  }
  const before = structuredClone(sourceSettings)
  const projected = toProfileSettings(sourceSettings, { name: 'Fallback', socials: [], email: 'fallback@example.com' })

  assert.deepEqual(projected.socials.map(({ id }) => id), [
    'linkedin',
    'instagram',
    'custom-facebook',
    'custom-youtube',
    'github',
    'telegram',
  ])
  assert.deepEqual(sourceSettings, before)

  const legacy = toProfileSettings({
    name: 'Legacy',
    socialLinks: {
      github: 'https://github.com/fitsum',
      instagram: 'https://instagram.com/fitsum',
    },
    customSocialLinks: [
      { id: 'custom-facebook', platform: 'Facebook', url: 'https://facebook.com/fitsum' },
    ],
  }, { name: 'Fallback', socials: [], email: 'fallback@example.com' })
  assert.deepEqual(legacy.socials.map(({ id }) => id), ['github', 'instagram', 'custom-facebook'])
})

test('media schema supports validated skill records without weakening media requirements', () => {
  const skill = {
    type: 'image',
    isSkill: true,
    name: 'React',
    category: 'Frontend',
    url: 'https://cdn.example.com/react.svg',
    storagePath: '',
    sizeBytes: 0,
  }
  assert.equal(mediaSchema.safeParse(skill).success, true)
  assert.equal(mediaSchema.safeParse({ ...skill, url: 'javascript:alert(1)' }).success, false)
  assert.equal(mediaSchema.safeParse({ ...skill, name: '' }).success, false)
  assert.equal(mediaSchema.safeParse({
    type: 'image',
    isSkill: true,
    name: 'React',
    url: '',
    storagePath: '',
    sizeBytes: 0,
  }).success, true)
  assert.equal(mediaSchema.safeParse({
    type: 'image',
    isSkillCatalog: true,
    url: '',
    storagePath: '',
    sizeBytes: 0,
  }).success, true)
  assert.equal(mediaSchema.safeParse({
    url: 'https://cdn.example.com/image.png',
    storagePath: '',
    type: 'image',
    sizeBytes: 0,
  }).success, false)
})
