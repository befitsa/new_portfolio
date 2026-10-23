import { z } from 'zod'

// Kept in sync with src/lib/db/contentSchemas.js. Backend validation is required
// even though the admin UI validates too; browsers are not trusted clients.
const url = z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))
const optionalUrl = z.union([z.literal(''), url])
const imageUrl = z.union([
  z.literal(''), url,
  z.string().refine((value) => /^\/(?!\/)[^\s]*$/.test(value) && !value.split('/').includes('..'), 'Image path must be a safe same-site path.'),
])
const text = (max = 5000) => z.string().trim().max(max)
const asset = z.object({
  url: imageUrl.default(''), storagePath: z.string().trim().max(1024).default(''),
  caption: text(300).default(''), order: z.number().int().nonnegative().default(0),
})
const projectCategory = z.union([
  z.enum(['Web', 'Mobile', 'UI/UX']),
  z.enum(['Web Design', 'Mobile App']),
]).transform((value) => value === 'Mobile App' || value === 'Mobile' ? 'Mobile' : value === 'UI/UX' ? 'UI/UX' : 'Web')

export const schemas = {
  projects: z.object({
    title: z.string().trim().min(1).max(120), slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    synopsis: text(200).default(''), executiveSummary: text(12000).default(''), category: projectCategory.default('Web'),
    role: text(120).default(''), timeline: text(120).default(''), readTime: z.number().int().nonnegative().default(0),
    featured: z.boolean().default(false), visibility: z.boolean().default(true), order: z.number().int().nonnegative().default(0),
    heroImage: asset.default({}), gallery: z.array(asset).max(30).default([]),
    links: z.object({ github: optionalUrl.default(''), figma: optionalUrl.default(''), live: optionalUrl.default('') }).default({}),
    techStack: z.array(z.string().trim().min(1).max(60)).max(40).default([]), coreProblem: text(6000).default(''),
    strategicObjectives: z.array(z.string().trim().min(1).max(500)).max(20).default([]), leadership: text(6000).default(''),
    methodology: text(6000).default(''),
    technicalHighlights: z.array(z.object({ title: z.string().trim().min(1).max(120), description: text(2000).default(''), tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]) })).max(30).default([]),
    metrics: z.array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(60), unit: text(40).default(''), description: text(500).default('') })).max(20).default([]),
    seo: z.object({ metaTitle: text(70).default(''), metaDescription: text(180).default('') }).default({}),
  }),
  experiences: z.object({
    role: z.string().trim().min(1).max(120), company: z.string().trim().min(1).max(120), logoInitials: text(8).default(''),
    startDate: z.string().date(), endDate: z.union([z.string().date(), z.literal('')]).default(''), isCurrent: z.boolean().default(false),
    location: text(120).default(''), employmentType: text(80).default(''), description: text(5000).default(''),
    skills: z.array(z.string().trim().min(1).max(60)).max(40).default([]), visibility: z.boolean().default(true), order: z.number().int().nonnegative().default(0),
  }).superRefine((v, c) => {
    if (v.isCurrent && v.endDate) c.addIssue({ code: 'custom', path: ['endDate'], message: 'A current role cannot have an end date.' })
    else if (!v.isCurrent && v.endDate && v.endDate < v.startDate) c.addIssue({ code: 'custom', path: ['endDate'], message: 'End date cannot be before start date.' })
  }),
  education: z.object({
    degree: z.string().trim().min(1).max(160), institution: z.string().trim().min(1).max(160),
    startYear: z.number().int().min(1900).max(2200), endYear: z.number().int().min(1900).max(2200).nullable().default(null),
    notes: text(3000).default(''), credentialUrl: optionalUrl.default(''), visibility: z.boolean().default(true), order: z.number().int().nonnegative().default(0),
  }).superRefine((v, c) => { if (v.endYear !== null && v.endYear < v.startYear) c.addIssue({ code: 'custom', path: ['endYear'], message: 'End year cannot be before the start year.' }) }),
  resumes: z.object({
    fileUrl: url, previewUrl: optionalUrl.default(''), storagePath: z.string().trim().min(1).max(1024), fileName: z.string().trim().min(1).max(255),
    sizeKB: z.number().positive().max(5120), version: z.string().trim().min(1).max(40), notes: text(1000).default(''),
    isActive: z.boolean().default(false), visibility: z.boolean().default(true), order: z.number().int().nonnegative().default(0),
  }),
  media: z.object({
    url, storagePath: z.string().trim().min(1).max(1024), type: z.enum(['image', 'pdf', 'other']),
    sizeBytes: z.number().int().positive().max(12 * 1024 * 1024), usedIn: z.array(z.string().trim().min(1).max(240)).max(100).default([]),
    visibility: z.boolean().default(true), order: z.number().int().nonnegative().default(0),
    fileName: text(255).default(''), mimeType: text(100).default(''), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
    sourceUrl: optionalUrl.default(''), alt: text(300).default(''),
  }),
}

export const settingsSchema = z.object({
  name: z.string().trim().min(1).max(120), title: text(160).default(''), bio: text(6000).default(''), about: text(3000).default(''), location: text(120).default(''),
  socialLinks: z.record(z.string().trim().min(1).max(40), z.string().trim().max(500)).default({}).superRefine((links, context) => {
    for (const [key, value] of Object.entries(links)) {
      if (!value) continue
      const emailLink = key === 'email' && /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value)
      if (!emailLink && !optionalUrl.safeParse(value).success) {
        context.addIssue({ code: 'custom', path: [key], message: 'Social links must use HTTP or HTTPS. Email may use a valid mailto address.' })
      }
    }
  }),
  featuredProjectIds: z.array(z.string().trim().min(1).max(128)).max(20).default([]),
  seo: z.object({ metaTitle: text(70).default(''), metaDescription: text(180).default('') }).default({}),
})

export function parsePayload(type, value) {
  const schema = schemas[type]
  if (!schema) throw Object.assign(new Error('Unsupported content type.'), { status: 404 })
  return schema.parse(value)
}
