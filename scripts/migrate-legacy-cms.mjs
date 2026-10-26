import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { contentSchemas, siteSettingsSchema } from '../src/lib/db/contentSchemas.js'

const TYPES = ['projects', 'experiences', 'education', 'resumes']
const legacyCredentials = JSON.parse(process.env.LEGACY_FIREBASE_SERVICE_ACCOUNT_JSON || 'null')
const destinationCredentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || 'null')
if (!legacyCredentials?.project_id || !destinationCredentials?.project_id) {
  throw new Error('Set LEGACY_FIREBASE_SERVICE_ACCOUNT_JSON and FIREBASE_SERVICE_ACCOUNT_JSON before running the migration.')
}
if (destinationCredentials.project_id !== 'user-auth-vp') throw new Error('Destination service account must belong to user-auth-vp.')
const legacyApp = initializeApp({ credential: cert(legacyCredentials), projectId: legacyCredentials.project_id }, 'legacy-cms-export')
const destinationApp = initializeApp({ credential: cert(destinationCredentials), projectId: 'user-auth-vp' }, 'portfolio-migration-target')
const source = getFirestore(legacyApp)
const destination = getFirestore(destinationApp)
const apply = process.argv.includes('--apply')

function cleanRecord(raw, type) {
  const { id, status, revision, publishedRevision, basePublishedRevision, createdAt, updatedAt, publishedAt, publishedBy, authorId, visibility, ...content } = raw
  const schema = contentSchemas[type]
  const parsed = schema.safeParse({ ...content, ...(visibility === undefined ? {} : { visibility }) })
  if (!parsed.success) return { error: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') }
  return { content: parsed.data, metadata: { id, status, revision, publishedRevision, createdAt, updatedAt, publishedAt, publishedBy, authorId, visibility } }
}

async function migrateCollection(type) {
  const [drafts, published] = await Promise.all([
    source.collection('drafts').doc(type).collection('items').get(),
    source.collection('published').doc(type).collection('items').get(),
  ])
  const draftMap = new Map(drafts.docs.map((doc) => [doc.id, doc.data()]))
  const publicMap = new Map(published.docs.map((doc) => [doc.id, doc.data()]))
  const ids = [...new Set([...draftMap.keys(), ...publicMap.keys()])]
  const accepted = []
  const skipped = []
  const slugOwners = new Map()
  for (const id of ids) {
    if (type === 'projects' && /^project-\d+$/i.test(id)) { skipped.push(`${type}/${id}: legacy placeholder slot`); continue }
    const draftRaw = draftMap.get(id) || publicMap.get(id)
    const publicRaw = publicMap.get(id)
    const draft = cleanRecord({ ...draftRaw, id }, type)
    const live = publicRaw ? cleanRecord({ ...publicRaw, id }, type) : null
    if (draft.error || live?.error) { skipped.push(`${type}/${id}: ${draft.error || live.error}`); continue }
    const slug = draft.content.slug
    if (type === 'projects' && slugOwners.has(slug) && slugOwners.get(slug) !== id) { skipped.push(`${type}/${id}: duplicate legacy slug ${slug}`); continue }
    if (type === 'projects') slugOwners.set(slug, id)
    const isPublished = publicRaw?.status === 'published' && publicRaw.visibility !== false
    const data = {
      type, status: isPublished ? 'published' : draftRaw?.status === 'unpublished' ? 'unpublished' : 'draft',
      revision: Math.max(1, Number(draft.metadata.revision || 1)),
      publishedRevision: isPublished ? Math.max(1, Number(live.metadata.revision || live.metadata.publishedRevision || 1)) : 0,
      draftData: draft.content, publishedData: isPublished ? live.content : null,
      createdAt: draft.metadata.createdAt || new Date(), updatedAt: draft.metadata.updatedAt || new Date(),
      publishedAt: isPublished ? (live.metadata.publishedAt || new Date()) : null,
      authorId: draft.metadata.authorId || '', publishedBy: live?.metadata.publishedBy || '',
      migrationSource: legacyCredentials.project_id,
    }
    accepted.push({ id, data })
  }
  const targetRefs = accepted.map(({ id }) => destination.collection('portfolioContent').doc(type).collection('items').doc(id))
  const existingTargets = await Promise.all(targetRefs.map((ref) => ref.get()))
  const pending = accepted.filter((item, index) => {
    if (existingTargets[index].exists) { skipped.push(`${type}/${item.id}: destination already has this ID`); return false }
    return true
  })
  if (apply && pending.length) {
    for (let offset = 0; offset < pending.length; offset += 400) {
      const batch = destination.batch()
      for (const item of pending.slice(offset, offset + 400)) {
        if (type === 'projects' && item.data.draftData.slug) {
          const slugRef = destination.collection('portfolioProjectSlugs').doc(item.data.draftData.slug)
          const slugSnapshot = await slugRef.get()
          if (slugSnapshot.exists && slugSnapshot.get('id') !== item.id) { skipped.push(`${type}/${item.id}: destination slug ${item.data.draftData.slug} is already in use`); continue }
        }
        batch.set(destination.collection('portfolioContent').doc(type).collection('items').doc(item.id), item.data, { merge: true })
        if (type === 'projects' && item.data.draftData.slug) batch.set(destination.collection('portfolioProjectSlugs').doc(item.data.draftData.slug), { id: item.id })
      }
      await batch.commit()
    }
  }
  return { type, sourceDrafts: drafts.size, sourcePublished: published.size, ready: pending.length, alreadyPresent: accepted.length - pending.length, skipped }
}

const reports = await Promise.all(TYPES.map(migrateCollection))
const [settingsDraft, settingsPublished] = await Promise.all([
  source.doc('drafts/site/settings/current').get(), source.doc('published/site/settings/current').get(),
])
let settingsReport = 'no legacy settings'
if (settingsDraft.exists || settingsPublished.exists) {
  const settingsTarget = destination.doc('portfolioContent/settings/items/current')
  const targetSettingsExists = (await settingsTarget.get()).exists
  const rawDraft = settingsDraft.exists ? settingsDraft.data() : settingsPublished.data()
  const rawPublished = settingsPublished.exists ? settingsPublished.data() : null
  const strip = (raw) => {
    if (!raw) return null
    const { id, status, revision, publishedRevision, basePublishedRevision, createdAt, updatedAt, publishedAt, publishedBy, ...data } = raw
    const parsed = siteSettingsSchema.safeParse(data)
    if (!parsed.success) throw new Error(`Legacy settings could not be migrated: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`)
    return parsed.data
  }
  const live = strip(rawPublished)
  const draft = strip(rawDraft)
  const isPublished = rawPublished?.status === 'published'
  if (apply && !targetSettingsExists) await destination.collection('portfolioContent').doc('settings').collection('items').doc('current').set({
    type: 'settings', status: isPublished ? 'published' : 'draft', revision: Math.max(1, Number(rawDraft.revision || 1)),
    publishedRevision: isPublished ? Math.max(1, Number(rawPublished.revision || 1)) : 0,
    draftData: draft, publishedData: isPublished ? live : null, createdAt: rawDraft.createdAt || new Date(), updatedAt: rawDraft.updatedAt || new Date(),
    publishedAt: isPublished ? rawPublished.publishedAt || new Date() : null, authorId: '', publishedBy: rawPublished?.publishedBy || '', migrationSource: legacyCredentials.project_id,
  }, { merge: true })
  settingsReport = targetSettingsExists ? 'legacy settings found; target already exists and was preserved' : 'legacy settings found and validated'
}

console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', sourceProject: legacyCredentials.project_id, destinationProject: destinationCredentials.project_id, collections: reports, settings: settingsReport }, null, 2))
if (!apply) console.log('Dry run only. Review the report, then run again with --apply to copy records. The legacy source is never modified.')
