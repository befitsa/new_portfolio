export async function publishSkillChanges(api, items, catalog) {
  for (const item of items.filter((entry) => !entry.pendingDelete)) {
    await api.publish('media', item.id, item.revision)
  }
  await api.publish('media', catalog.id, catalog.revision)
  for (const item of items.filter((entry) => entry.pendingDelete)) {
    await api.deleteItem('media', item.id)
  }
}
