import { useSyncExternalStore } from 'react'
import { localCmsApi } from '../admin/localCmsStore.js'
import { isPathBasedAdmin } from '../admin/cmsPaths.js'
import {
  hasProductionCmsProvider,
  isLocalFilesystemCms,
  productionCmsConfigurationError,
  productionCmsStorageLabel,
} from '../services/cmsProvider.js'
import { supabase } from './supabase.js'
import { createSupabaseCmsApi, SupabaseCmsError } from './supabaseCmsApi.js'

const statusLabels = {
  checking: 'Checking CMS…',
  local: 'Local JSON + disk uploads',
  supabase: productionCmsStorageLabel,
  unconfigured: 'Production CMS not configured',
  auth: 'Administrator sign-in required',
  serverError: 'Supabase CMS unavailable',
}

const productionMessage = `Production CMS is not configured: ${productionCmsConfigurationError}`

export function isLocalCmsMode() {
  return isLocalFilesystemCms && isPathBasedAdmin()
}

export class CmsApiError extends Error {
  constructor(state, message, status = 0) {
    super(message)
    this.name = 'CmsApiError'
    this.state = state
    this.status = status
  }
}

const productionApi = hasProductionCmsProvider ? createSupabaseCmsApi(supabase) : null
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
    if (productionApi && property in productionApi) {
      const value = Reflect.get(productionApi, property, productionApi)
      return typeof value === 'function' ? value.bind(productionApi) : value
    }
    return Reflect.get(target, property, receiver)
  },
})

let apiStatus = isLocalCmsMode()
  ? { state: 'checking', ready: false, storageReady: false, checking: true, label: statusLabels.checking, message: statusLabels.checking, checkedAt: null }
  : hasProductionCmsProvider
    ? { state: 'checking', ready: false, storageReady: false, checking: true, label: statusLabels.checking, message: 'Checking Supabase administrator access and storage…', checkedAt: null }
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

export async function checkCmsApiHealth() {
  if (isLocalCmsMode()) {
    updateApiStatus({ state: 'checking', ready: false, checking: true, message: 'Loading local portfolio content…', checkedAt: apiStatus.checkedAt })
    try {
      const health = await localCmsApi.health()
      const note = health.recoveryNotice ? ` ${health.recoveryNotice}` : ''
      updateApiStatus({
        state: 'local', ready: true, storageReady: true, checking: false,
        message: `Development mode: changes are saved in local JSON files and uploads are stored on this machine. They are not published to the live website.${note}`,
        checkedAt: new Date().toISOString(),
      })
      return true
    } catch (cause) {
      const error = cause instanceof CmsApiError ? cause : new CmsApiError('serverError', cause?.message || 'Local portfolio storage could not be opened.')
      updateApiStatus({ state: error.state, ready: false, checking: false, message: `${error.message} The admin interface remains in read-only mode.`, checkedAt: new Date().toISOString() })
      return false
    }
  }

  if (!productionApi) {
    updateApiStatus({ state: 'unconfigured', ready: false, storageReady: false, checking: false, message: productionMessage, checkedAt: new Date().toISOString() })
    return false
  }

  updateApiStatus({ state: 'checking', ready: false, checking: true, message: 'Checking Supabase administrator access and storage…', checkedAt: apiStatus.checkedAt })
  try {
    const health = await productionApi.health()
    const databaseReady = health?.database?.ready === true
    const storageReady = health?.storage?.ready === true
    const ready = health?.ok === true && health?.admin === true && databaseReady && storageReady
    const unavailable = [
      !health?.admin ? 'Sign in with the registered Supabase portfolio administrator account.' : '',
      !databaseReady ? health?.database?.message || 'Supabase Postgres is unavailable.' : '',
      !storageReady ? health?.storage?.message || 'Supabase Storage is not configured for public and private portfolio assets.' : '',
    ].filter(Boolean)
    updateApiStatus({
      state: ready ? 'supabase' : 'serverError',
      ready,
      storageReady,
      storageMessage: health?.storage?.message || '',
      checking: false,
      message: ready
        ? 'Supabase is connected. Drafts and published content are stored in Postgres; published updates are reflected through live portfolio subscriptions.'
        : unavailable.join(' '),
      checkedAt: new Date().toISOString(),
    })
    return ready
  } catch (cause) {
    const error = cause instanceof SupabaseCmsError
      ? cause
      : new CmsApiError('serverError', cause?.message || 'The Supabase CMS health check failed.')
    updateApiStatus({
      state: error.state === 'auth' ? 'auth' : 'serverError',
      ready: false,
      storageReady: false,
      checking: false,
      message: error.message,
      storageMessage: error.message,
      checkedAt: new Date().toISOString(),
    })
    return false
  }
}
