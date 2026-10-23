// Development adapter for the same content service used by the public site.
// Production requests continue to use the configured CMS API client.
import { contentService } from '../services/contentService.js'

export const localCmsApi = Object.freeze({
  health: (...args) => contentService.health(...args),
  list: (...args) => contentService.list(...args),
  get: (...args) => contentService.get(...args),
  create: (...args) => contentService.create(...args),
  save: (...args) => contentService.save(...args),
  publish: (...args) => contentService.publish(...args),
  unpublish: (...args) => contentService.unpublish(...args),
  deleteItem: (...args) => contentService.deleteItem(...args),
  reorder: (...args) => contentService.reorder(...args),
  removeMedia: (...args) => contentService.removeMedia(...args),
  getSettings: (...args) => contentService.getSettings(...args),
  saveSettings: (...args) => contentService.saveSettings(...args),
  publishSettings: (...args) => contentService.publishSettings(...args),
  importImage: (...args) => contentService.importImage(...args),
  upload: (...args) => contentService.upload(...args),
})
