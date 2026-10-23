import { adminApi } from '../adminApi.js'

// All CMS mutations go through the Cloudflare Access protected backend. Never
// write drafts, published documents, or media directly from the browser.
export async function createDraft(type, initialContent = {}) {
  const record = await adminApi.create(type, initialContent)
  return record.id
}

export async function saveDraft(type, id, content, { expectedRevision = 0 } = {}) {
  return adminApi.save(type, id, content, expectedRevision)
}

export async function publishItems(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('Select at least one draft to publish.')
  const published = []
  for (const item of items) published.push(await adminApi.publish(item.type, item.id, item.expectedRevision))
  return { publishedCount: published.length, items: published }
}

export async function publishItem(type, id, { expectedRevision } = {}) {
  if (!Number.isInteger(expectedRevision)) {
    const draft = await adminApi.get(type, id)
    expectedRevision = draft?.revision
  }
  return adminApi.publish(type, id, expectedRevision)
}

export async function publishSection(type) {
  const drafts = await adminApi.list(type)
  const pending = drafts.filter((item) => item.status === 'draft')
  return publishItems(pending.map(({ id, revision }) => ({ type, id, expectedRevision: revision })))
}

export async function saveSiteSettingsDraft(value, { expectedRevision = 0 } = {}) {
  return adminApi.saveSettings(value, expectedRevision)
}

export async function publishSiteSettings({ expectedRevision } = {}) {
  if (!Number.isInteger(expectedRevision)) expectedRevision = (await adminApi.getSettings())?.revision
  return adminApi.publishSettings(expectedRevision)
}

export async function unpublishItem(type, id) {
  return adminApi.unpublish(type, id)
}

export async function setPublishedVisibility(type, id, visibility) {
  const draft = await adminApi.get(type, id)
  const current = draft || await adminApi.get(type, id, 'published')
  if (!current) throw new Error('Content item was not found.')
  const { id: itemId, status, revision, publishedRevision, basePublishedRevision, createdAt, updatedAt, publishedAt, publishedBy, ...content } = current
  return adminApi.save(type, id, { ...content, visibility }, draft?.revision ?? 0)
}

export async function reorderPublishedItems(type, orderedIds) {
  const records = await Promise.all(orderedIds.map(async (id) => (
    await adminApi.get(type, id) || await adminApi.get(type, id, 'published')
  )))
  const results = []
  for (const [order, record] of records.entries()) {
    if (!record) continue
    const { id, status, revision, publishedRevision, basePublishedRevision, createdAt, updatedAt, publishedAt, publishedBy, ...content } = record
    results.push(await adminApi.save(type, id, { ...content, order }, record.status === 'published' && !record.revision ? 0 : record.revision))
  }
  return results
}

export async function deleteDraft(type, id) {
  return adminApi.unpublish(type, id)
}

export async function listDrafts(type) {
  return (await adminApi.list(type)).filter((item) => item.status === 'draft')
}
