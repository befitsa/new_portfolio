import { profile } from './profile.js'
import { siteSettingsSchema } from '../lib/db/contentSchemas.js'

const timestamp = () => ({ seconds: Math.floor(Date.now() / 1000) })

export function createDefaultContentState() {
  const settingsContent = siteSettingsSchema.parse({
    name: profile.name,
    title: profile.title,
    bio: profile.intro,
    about: profile.about,
    location: '',
    socialLinks: Object.fromEntries(profile.socials.map(({ id, url }) => [id, url])),
    featuredProjectIds: [],
    seo: { metaTitle: '', metaDescription: '' },
  })
  const settingsTime = timestamp()
  const settings = { ...settingsContent, id: 'settings', status: 'published', revision: 1, publishedRevision: 1, basePublishedRevision: 1, visibility: true, resumeManaged: true, createdAt: settingsTime, updatedAt: settingsTime, publishedAt: settingsTime }
  const blankCollections = () => ({ projects: [], experiences: [], education: [], resumes: [], media: [] })
  return {
    schemaVersion: 2,
    drafts: blankCollections(),
    published: blankCollections(),
    settings: { drafts: { ...settings }, published: settings },
  }
}
