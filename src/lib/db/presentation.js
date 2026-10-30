import { normalizeProjectCategory } from './contentSchemas.js'

/** Convert the CMS project shape to the legacy public portfolio view model. */
export function toPublicProject(record) {
  const gallery = Array.isArray(record.gallery) ? record.gallery : []
  const highlights = Array.isArray(record.technicalHighlights)
    ? record.technicalHighlights
    : []
  const objectives = Array.isArray(record.strategicObjectives)
    ? record.strategicObjectives
    : []
  const metrics = Array.isArray(record.metrics) ? record.metrics : []

  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    description: record.synopsis || String(record.executiveSummary || '').replace(/```[\s\S]*?```|!\[([^\]]*)\]\([^)]+\)|\[([^\]]+)\]\([^)]+\)|[*_`#>~-]/g, '$1$2').replace(/\s+/g, ' ').trim(),
    summary: record.executiveSummary || '',
    category: normalizeProjectCategory(record.category),
    role: record.role || '',
    timeline: record.timeline || '',
    status: 'Published',
    tech: Array.isArray(record.techStack) ? record.techStack : [],
    image: record.heroImage?.url || '',
    preview3d: null,
    liveUrl: record.links?.live || '',
    sourceUrl: record.links?.github || '',
    figmaUrl: record.links?.figma || '',
    problem: record.coreProblem || '',
    features: highlights.length
      ? highlights
      : objectives.map((title) => ({ title, description: '' })),
    outcomes: metrics.map((metric) => ({
      title: metric.label,
      value: metric.value,
      description: [metric.unit, metric.description].filter(Boolean).join(' · '),
    })),
    metrics,
    screenshots: gallery.map((image) => ({
      src: image.url,
      title: image.caption || 'Project interface',
      alt: image.caption || `${record.title} interface`,
    })),
    isPlaceholder: /^Project slot \d+$/i.test(record.title || '') && !record.heroImage?.url && (!record.synopsis || /^placeholder\b/i.test(record.synopsis)) && !record.executiveSummary,
    seo: record.seo || {},
    featured: Boolean(record.featured),
    order: record.order ?? 0,
  }
}

export function toPublicExperience(record) {
  const formatDate = (value) => {
    if (!value) return ''
    const [year, month, day] = value.split('-').map(Number)
    if (!year || !month || !day) return value
    return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' })
      .format(new Date(year, month - 1, day))
  }
  const start = formatDate(record.startDate)
  const end = record.isCurrent ? 'Present' : formatDate(record.endDate)
  const date = [start, end].filter(Boolean).join(' — ')
  const place = [record.company, record.location, record.employmentType].filter(Boolean).join(' · ')

  return {
    id: record.id,
    title: record.role,
    place,
    date,
    description: record.description || '',
    skills: Array.isArray(record.skills) ? record.skills : [],
    recommendationLetterUrl: record.recommendationLetterUrl || '',
    recommendationLetterImageUrl: record.recommendationLetter?.url || '',
    order: record.order ?? 0,
  }
}

export function toPublicEducation(record) {
  const date = record.endYear
    ? `${record.startYear} — ${record.endYear}`
    : String(record.startYear ?? '')

  return {
    id: record.id,
    title: record.degree === 'Other' ? record.customDegree || 'Other' : record.degree,
    place: [record.institution, record.notes].filter(Boolean).join(' · '),
    date,
    description: '',
    credentialUrl: record.credentialUrl || '',
    credentialImageUrl: record.credentialImage?.url || '',
    order: record.order ?? 0,
  }
}

export function toProfileSettings(settings, fallback) {
  if (!settings) return fallback

  const name = settings.name?.trim() || fallback.name
  const nameParts = name.split(/\s+/)
  const socials = Object.entries(settings.socialLinks || {}).map(([id, url]) => ({
    id,
    label: id === 'github' ? 'GitHub' : id === 'linkedin' ? 'LinkedIn' : id[0].toUpperCase() + id.slice(1),
    url,
  }))

  return {
    ...fallback,
    name,
    firstName: nameParts[0] || fallback.firstName,
    lastName: nameParts.slice(1).join(' ') || fallback.lastName,
    monogram: nameParts.map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
    title: settings.title?.trim() || fallback.title,
    intro: settings.bio?.trim() || fallback.intro,
    about: settings.about?.trim() || fallback.about,
    location: settings.location?.trim() || '',
    email: settings.socialLinks?.email
      ? settings.socialLinks.email.replace(/^mailto:/i, '').split('?')[0]
      : fallback.email,
    socials,
    seo: settings.seo || {},
    featuredProjectIds: Array.isArray(settings.featuredProjectIds) ? settings.featuredProjectIds : [],
  }
}
