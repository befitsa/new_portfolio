import { z } from 'zod'

const httpUrlSchema = z.string().url().refine((value) => {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}, 'URL must use HTTP or HTTPS.')
const socialProfileUrlSchema = z.string().trim().url().refine((value) => {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}, 'Profile URL must use HTTP or HTTPS.')
const optionalUrl = z.union([z.literal(''), httpUrlSchema])
const localFileUrl = z.string().refine((value) => /^\/__local-cms\/uploads\/[a-z0-9-]+\/[a-zA-Z0-9._-]+$/.test(value) && !value.split('/').includes('..'), 'Local file URL must be a safe development upload path.')
const storedFileUrl = z.union([httpUrlSchema, localFileUrl])
const optionalText = (max = 5000) => z.string().trim().max(max)
export function normalizeSkills(value) {
  const entries = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []
  const seen = new Set()
  return entries
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (!entry) return false
      const key = entry.toLocaleLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}
const imageUrl = z.union([
  z.literal(''),
  httpUrlSchema,
  z.string().refine((value) => /^\/(?!\/)[^\s]*$/.test(value) && !value.split('/').includes('..'), 'Image path must be a safe same-site path.'),
])
const imageAssetSchema = z.object({
  url: imageUrl.default(''),
  storagePath: z.string().trim().max(1024).default(''),
  caption: optionalText(300).default(''),
  order: z.number().int().nonnegative().default(0),
})
const technologySchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(60),
  logo: imageAssetSchema.default({}),
  description: optionalText(300).default(''),
})
const optionalPrivateImage = z.object({
  url: z.union([z.literal(''), httpUrlSchema, localFileUrl]).default(''),
  storagePath: z.string().trim().max(1024).default(''),
}).nullable().default(null)
const customSocialLinkSchema = z.object({
  id: z.string().trim().min(1).max(128),
  platform: z.string().trim().min(1).max(60),
  url: socialProfileUrlSchema,
  logo: optionalPrivateImage,
  displayOrder: z.number().int().positive().optional(),
  enabled: z.boolean().default(true),
})
const socialLinkDetailSchema = z.object({
  platform: optionalText(60).default(''),
  enabled: z.boolean().default(true),
  logo: optionalPrivateImage,
})

export function normalizeTechnologyStack(value) {
  const entries = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []
  const usedIds = new Set()
  return entries.flatMap((entry, index) => {
    const rawName = typeof entry === 'string' ? entry : entry?.name ?? entry?.title ?? ''
    const name = typeof rawName === 'string' ? rawName.trim() : ''
    if (!name) return []

    const baseId = (typeof entry === 'object' && entry?.id
      ? String(entry.id).trim()
      : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100)) || `technology-${index + 1}`
    let id = baseId
    let suffix = 2
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`
    usedIds.add(id)

    const sourceLogo = typeof entry === 'object' ? entry?.logo : null
    const logo = typeof sourceLogo === 'string'
      ? { url: sourceLogo, storagePath: '' }
      : { url: '', storagePath: '', ...(sourceLogo && typeof sourceLogo === 'object' ? sourceLogo : {}) }

    return [{
      id,
      name,
      logo,
      description: typeof entry === 'object' && typeof entry?.description === 'string'
        ? entry.description
        : '',
    }]
  })
}

export function normalizeProjectCategory(value) {
  if (value === 'Mobile App' || value === 'Mobile') return 'Mobile'
  if (value === 'UI/UX') return 'UI/UX'
  return 'Web'
}

export function normalizeProjectImageFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  const asset = (image, order = 0) => {
    if (typeof image === 'string') return { url: image, storagePath: '', caption: '', order }
    if (!image || typeof image !== 'object') return null
    const url = image.url || image.src || ''
    return {
      ...image,
      url,
      caption: image.caption || image.title || '',
      order: Number.isInteger(image.order) ? image.order : order,
    }
  }
  const legacyCover = asset(value.coverImage || value.image)
  const canonicalCover = asset(value.heroImage)
  const heroImage = canonicalCover?.url || canonicalCover?.storagePath
    ? canonicalCover
    : legacyCover || canonicalCover
  const cardImage = value.cardImage === undefined ? undefined : asset(value.cardImage)
  let gallery = value.gallery
  if (!Array.isArray(gallery)) {
    const legacyGallery = value.galleryImages ?? value.screenshots
    gallery = Array.isArray(legacyGallery) ? legacyGallery : []
  }
  gallery = gallery
    .map((image, index) => asset(image, index))
    .filter((image) => image && (!heroImage?.url || image.url !== heroImage.url))

  return {
    ...value,
    ...(cardImage === undefined ? {} : { cardImage }),
    heroImage: heroImage || undefined,
    gallery,
  }
}

const projectCategorySchema = z.union([
  z.enum(['Web', 'Mobile', 'UI/UX']),
  z.enum(['Web Design', 'Mobile App']),
]).transform(normalizeProjectCategory)

export const projectSchema = z.preprocess(normalizeProjectImageFields, z.object({
  title: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  synopsis: optionalText(200).default(''),
  executiveSummary: optionalText(12000).default(''),
  category: projectCategorySchema.default('Web'),
  role: optionalText(120).default(''),
  timeline: optionalText(120).default(''),
  readTime: z.number().int().nonnegative().default(0),
  featured: z.boolean().default(false),
  visibility: z.boolean().default(true),
  order: z.number().int().nonnegative().default(0),
  cardImage: imageAssetSchema.nullable().optional(),
  heroImage: imageAssetSchema.default({}),
  gallery: z.array(imageAssetSchema).max(30).default([]),
  links: z.object({
    github: optionalUrl.default(''),
    figma: optionalUrl.default(''),
    live: optionalUrl.default(''),
  }).default({ github: '', figma: '', live: '' }),
  techStack: z.preprocess(
    normalizeTechnologyStack,
    z.array(technologySchema).max(40).default([]),
  ),
  coreProblem: optionalText(6000).default(''),
  strategicObjectives: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  leadership: optionalText(6000).default(''),
  methodology: optionalText(6000).default(''),
  technicalHighlights: z.array(z.object({
    title: z.string().trim().min(1).max(120),
    description: optionalText(2000).default(''),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  })).max(30).default([]),
  metrics: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(60),
    unit: optionalText(40).default(''),
    description: optionalText(500).default(''),
  })).max(20).default([]),
  seo: z.object({
    metaTitle: optionalText(70).default(''),
    metaDescription: optionalText(180).default(''),
  }).default({}),
}))

export const experienceSchema = z.object({
  role: z.string().trim().min(1).max(120),
  company: z.string().trim().min(1).max(120),
  logoInitials: optionalText(8).default(''),
  startDate: z.string().date(),
  endDate: z.union([z.string().date(), z.literal('')]).default(''),
  isCurrent: z.boolean().default(false),
  location: optionalText(120).default(''),
  employmentType: optionalText(80).default(''),
  description: optionalText(5000).default(''),
  skills: z.preprocess(
    normalizeSkills,
    z.array(z.string().min(1).max(60)).max(40),
  ).default([]),
  recommendationLetter: optionalPrivateImage,
  recommendationLetterUrl: optionalUrl.default(''),
  visibility: z.boolean().default(true),
  order: z.number().int().nonnegative().default(0),
}).superRefine((value, context) => {
  if (value.isCurrent && value.endDate) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'A current role cannot have an end date.',
    })
  } else if (
    !value.isCurrent &&
    value.endDate &&
    value.endDate < value.startDate
  ) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'End date cannot be before start date.',
    })
  }
})

export const educationSchema = z.object({
  degree: z.string().trim().min(1).max(160),
  customDegree: optionalText(160).default(''),
  institution: z.string().trim().min(1).max(160),
  startYear: z.number().int().min(1900).max(2200),
  endYear: z.number().int().min(1900).max(2200).nullable().default(null),
  notes: optionalText(3000).default(''),
  credentialUrl: optionalUrl.default(''),
  credentialImage: optionalPrivateImage,
  visibility: z.boolean().default(true),
  order: z.number().int().nonnegative().default(0),
}).superRefine((value, context) => {
  if (value.degree === 'Other' && !value.customDegree.trim()) {
    context.addIssue({
      code: 'custom',
      path: ['customDegree'],
      message: 'Enter the custom qualification.',
    })
  }
  if (value.endYear !== null && value.endYear < value.startYear) {
    context.addIssue({
      code: 'custom',
      path: ['endYear'],
      message: 'End year cannot be before start year.',
    })
  }
})

export const resumeSchema = z.object({
  fileUrl: storedFileUrl,
  previewUrl: z.union([z.literal(''), storedFileUrl]).default(''),
  storagePath: z.string().trim().min(1).max(1024),
  fileName: z.string().trim().min(1).max(255),
  sizeKB: z.number().positive().max(5120),
  version: z.string().trim().min(1).max(40),
  notes: optionalText(1000).default(''),
  isActive: z.boolean().default(false),
  visibility: z.boolean().default(true),
  order: z.number().int().nonnegative().default(0),
})

export const mediaSchema = z.object({
  url: z.union([z.literal(''), storedFileUrl]).default(''),
  storagePath: z.string().trim().max(1024).default(''),
  type: z.enum(['image', 'pdf', 'other']),
  sizeBytes: z.number().int().nonnegative().max(12 * 1024 * 1024),
  fileName: optionalText(255).default(''),
  mimeType: optionalText(100).default(''),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  sourceUrl: optionalUrl.default(''),
  alt: optionalText(300).default(''),
  usedIn: z.array(z.string().trim().min(1).max(240)).max(100).default([]),
  visibility: z.boolean().default(true),
  order: z.number().int().nonnegative().default(0),
  isSkill: z.boolean().default(false),
  isSkillCatalog: z.boolean().default(false),
  name: optionalText(120).default(''),
  category: optionalText(80).default(''),
  pendingDelete: z.boolean().default(false),
}).superRefine((media, context) => {
  if (media.isSkill && media.isSkillCatalog) {
    context.addIssue({ code: 'custom', path: ['isSkillCatalog'], message: 'A skill cannot also be a skills catalog marker.' })
  }
  if (media.pendingDelete && !media.isSkill) {
    context.addIssue({ code: 'custom', path: ['pendingDelete'], message: 'Only skills can be marked for removal.' })
  }
  if (media.isSkill && !media.name) {
    context.addIssue({ code: 'custom', path: ['name'], message: 'Skill name is required.' })
  }
  if (media.isSkill || media.isSkillCatalog) {
    if (media.type !== 'image') {
      context.addIssue({ code: 'custom', path: ['type'], message: 'Skills catalog records must be images.' })
    }
    if (media.storagePath && (!media.url || media.sizeBytes === 0)) {
      context.addIssue({ code: 'custom', path: ['storagePath'], message: 'Uploaded skill logos require a URL and positive file size.' })
    }
    if (!media.storagePath && media.sizeBytes > 0) {
      context.addIssue({ code: 'custom', path: ['sizeBytes'], message: 'A file size requires a managed storage path.' })
    }
    return
  }
  if (!media.url || !media.storagePath || media.sizeBytes === 0) {
    context.addIssue({ code: 'custom', path: ['storagePath'], message: 'Media requires a URL, storage path, and positive file size.' })
  }
})

export const siteSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  title: optionalText(160).default(''),
  bio: optionalText(6000).default(''),
  about: optionalText(3000).default(''),
  location: optionalText(120).default(''),
  socialLinks: z.record(z.string().trim().min(1).max(40), z.string().trim().max(500)).default({}).superRefine((links, context) => {
    for (const [key, value] of Object.entries(links)) {
      if (!value) continue
      const emailLink = key === 'email' && /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value)
      if (!emailLink && !httpUrlSchema.safeParse(value).success) {
        context.addIssue({ code: 'custom', path: [key], message: 'Social links must use HTTP or HTTPS. Email may use a valid mailto address.' })
      }
    }
  }),
  socialLinkDisplayOrders: z.record(
    z.string().trim().min(1).max(40),
    z.number().int().positive(),
  ).default({}),
  socialLinkDetails: z.record(
    z.string().trim().min(1).max(40),
    socialLinkDetailSchema,
  ).default({}),
  customSocialLinks: z.array(customSocialLinkSchema).default([]).superRefine((links, context) => {
    const ids = new Set()
    links.forEach((link, index) => {
      if (ids.has(link.id)) {
        context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Custom social media entries must have unique IDs.' })
      }
      ids.add(link.id)
    })
  }),
  featuredProjectIds: z.array(z.string().trim().min(1).max(128)).max(20).default([]),
  visibility: z.boolean().default(true),
  seo: z.object({
    metaTitle: optionalText(70).default(''),
    metaDescription: optionalText(180).default(''),
  }).default({}),
})

export const contentSchemas = Object.freeze({
  projects: projectSchema,
  experiences: experienceSchema,
  education: educationSchema,
  resumes: resumeSchema,
  media: mediaSchema,
})

/**
 * @typedef {keyof typeof contentSchemas} ContentType
 * @typedef {import('zod').infer<typeof projectSchema>} ProjectContent
 * @typedef {import('zod').infer<typeof experienceSchema>} ExperienceContent
 * @typedef {import('zod').infer<typeof educationSchema>} EducationContent
 * @typedef {import('zod').infer<typeof resumeSchema>} ResumeContent
 * @typedef {import('zod').infer<typeof mediaSchema>} MediaContent
 * @typedef {import('zod').infer<typeof siteSettingsSchema>} SiteSettings
 * @typedef {{ id: string; status: 'draft' | 'published' | 'unpublished'; revision: number; publishedRevision: number; basePublishedRevision?: number; createdAt?: import('firebase/firestore').Timestamp; updatedAt?: import('firebase/firestore').Timestamp; publishedAt?: import('firebase/firestore').Timestamp; publishedBy?: string; visibility: boolean; order: number }} ContentMetadata
 */

export function parseContent(type, value) {
  const schema = contentSchemas[type]
  if (!schema) throw new Error(`Unsupported CMS content type: ${type}`)
  return schema.parse(value)
}
