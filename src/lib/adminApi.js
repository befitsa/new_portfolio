import { useSyncExternalStore } from 'react'
import { localCmsApi } from '../admin/localCmsStore.js'
import { isPathBasedAdmin } from '../admin/cmsPaths.js'
import { isLocalFilesystemCms } from '../services/cmsProvider.js'

const statusLabels = {
  checking: 'Checking local CMS…',
  local: 'Local JSON + disk uploads',
  unconfigured: 'Production CMS not configured',
  serverError: 'Local CMS unavailable',
}

const productionMessage = 'Live CMS editing is not configured for this deployment. Use npm run dev for local JSON and disk storage, or add a persistent production CMS provider before editing live content.'

export function isLocalCmsMode() {
  return isLocalFilesystemCms && isPathBasedAdmin()
}

let apiStatus = isLocalCmsMode()
  ? { state: 'checking', ready: false, storageReady: false, checking: true, label: statusLabels.checking, message: statusLabels.checking, checkedAt: null }
  : { state: 'unconfigured', ready: false, storageReady: false, checking: false, label: statusLabels.unconfigured, message: productionMessage, checkedAt: new Date().toISOString() }
const statusListeners = new Set()

function updateApiStatus(next) {
  apiStatus = { ...next, label: next.label || statusLabels[next.state] || 'CMS unavailable' }
  statusListeners.forEach((listener) => listener())
}

function subscribeApiStatus(listener) {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function useCmsApiStatus() {
  return useSyncExternalStore(subscribeApiStatus, () => apiStatus, () => apiStatus)
}

export class CmsApiError extends Error {
  constructor(state, message, status = 0) {
    super(message)
    this.name = 'CmsApiError'
    this.state = state
    this.status = status
  }
}

const unavailableApi = new Proxy({}, {
  get() {
    return async () => { throw new CmsApiError('unconfigured', productionMessage) }
  },
})

export const adminApi = new Proxy(unavailableApi, {
  get(target, property, receiver) {
    if (isLocalCmsMode() && property in localCmsApi) {
      const value = Reflect.get(localCmsApi, property, localCmsApi)
      return typeof value === 'function' ? value.bind(localCmsApi) : value
    }
    return Reflect.get(target, property, receiver)
  },
})

export async function checkCmsApiHealth() {
  if (!isLocalCmsMode()) {
    updateApiStatus({
      state: 'unconfigured',
      ready: false,
      storageReady: false,
      checking: false,
      message: productionMessage,
      checkedAt: new Date().toISOString(),
    })
    return false
  }

  updateApiStatus({ state: 'checking', ready: false, checking: true, message: 'Loading local portfolio content…', checkedAt: apiStatus.checkedAt })
  try {
    const health = await localCmsApi.health()
    const note = health.recoveryNotice ? ` ${health.recoveryNotice}` : ''
    updateApiStatus({
      state: 'local',
      ready: true,
      storageReady: true,
      checking: false,
      message: `Development mode: changes are saved in local JSON files and uploads are stored on this machine. They are not published to the live website.${note}`,
      checkedAt: new Date().toISOString(),
    })
    return true
  } catch (cause) {
    const error = cause instanceof CmsApiError
      ? cause
      : new CmsApiError('serverError', cause?.message || 'Local portfolio storage could not be opened.')
    updateApiStatus({
      state: error.state,
      ready: false,
      checking: false,
      message: `${error.message} The admin interface remains available in read-only mode.`,
      checkedAt: new Date().toISOString(),
    })
    return false
  }
}
