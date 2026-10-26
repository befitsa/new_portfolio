import { useSyncExternalStore } from 'react'
import { localCmsApi } from '../admin/localCmsStore.js'
import { isPathBasedAdmin } from '../admin/cmsPaths.js'
import { hasProductionCmsProvider, isLocalFilesystemCms, productionCmsApiUrl, productionCmsConfigurationError } from '../services/cmsProvider.js'
import { auth } from './firebase.js'
import { parseContent, siteSettingsSchema } from './db/contentSchemas.js'

const statusLabels = {
  checking: 'Checking CMS API…',
  local: 'Local JSON + disk uploads',
  firebase: 'Firebase CMS API',
  unconfigured: 'Production CMS not configured',
  serverError: 'Production CMS unavailable',
}

const productionMessage = `Production CMS is not configured: ${productionCmsConfigurationError} Rebuild the site after setting its Netlify variables.`

export function isLocalCmsMode() {
  return isLocalFilesystemCms && isPathBasedAdmin()
}

function encoded(value) {
  return encodeURIComponent(value)
}

function errorState(status) {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 413 || status === 422) return 'validation'
  return 'serverError'
}

export class CmsApiError extends Error {
  constructor(state, message, status = 0) {
    super(message)
    this.name = 'CmsApiError'
    this.state = state
    this.status = status
  }
}

async function apiRequest(path, { method = 'GET', body, signal } = {}) {
  if (!productionCmsApiUrl) throw new CmsApiError('unconfigured', productionMessage)
  const currentUser = auth?.currentUser
  if (!currentUser) throw new CmsApiError('auth', 'Sign in to the administrator account before editing live content.', 401)

  let response
  try {
    const idToken = await currentUser.getIdToken()
    response = await fetch(`${productionCmsApiUrl}/api${path}`, {
      method,
      cache: 'no-store',
      signal,
      headers: {
        Accept: 'application/json',
        'X-Firebase-Id-Token': idToken,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause
    throw new CmsApiError('serverError', cause?.message || 'Could not reach the production CMS API.')
  }

  const text = await response.text()
  let payload
  try { payload = text ? JSON.parse(text) : null } catch { payload = null }
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : `CMS API request failed (${response.status}).`
    throw new CmsApiError(errorState(response.status), message, response.status)
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !payload || !Object.hasOwn(payload, 'data')) {
    throw new CmsApiError('serverError', 'The production CMS API returned an invalid response.')
  }
  return payload.data
}

function uploadToSignedUrl(file, signedUpload, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', signedUpload.url)
    for (const [name, value] of Object.entries(signedUpload.requiredHeaders || {})) xhr.setRequestHeader(name, value)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.max(1, Math.round((event.loaded / event.total) * 85)))
    }
    xhr.onerror = () => reject(new CmsApiError('upload', 'The file could not be uploaded to managed storage.'))
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new CmsApiError('upload', `Managed storage rejected the upload (${xhr.status}).`, xhr.status))
        return
      }
      resolve()
    }
    xhr.send(file)
  })
}

const productionApi = {
  list: (type, view = 'drafts') => apiRequest(`/${encoded(type)}?view=${encoded(view)}`),
  get: (type, id, view = 'drafts') => apiRequest(`/${encoded(type)}/${encoded(id)}?view=${encoded(view)}`),
  create: (type, content) => apiRequest(`/${encoded(type)}`, { method: 'POST', body: { content: parseContent(type, content) } }),
  save: (type, id, content, expectedRevision = 0) => apiRequest(`/${encoded(type)}/${encoded(id)}`, {
    method: 'PUT',
    body: { content: parseContent(type, content), expectedRevision },
  }),
  publish: async (type, id, expectedRevision) => {
    if (!Number.isInteger(expectedRevision)) {
      const draft = await productionApi.get(type, id)
      if (!draft) throw new CmsApiError('not_found', 'Draft was not found.', 404)
      expectedRevision = draft.revision
    }
    return apiRequest(`/${encoded(type)}/${encoded(id)}/publish`, { method: 'POST', body: { expectedRevision } })
  },
  unpublish: (type, id) => apiRequest(`/${encoded(type)}/${encoded(id)}/unpublish`, { method: 'POST' }),
  deleteItem: (type, id) => apiRequest(`/${encoded(type)}/${encoded(id)}`, { method: 'DELETE' }),
  reorder: (type, items) => apiRequest(`/${encoded(type)}/reorder`, { method: 'PATCH', body: { items } }),
  removeMedia: (id) => apiRequest(`/media/${encoded(id)}`, { method: 'DELETE' }),
  getSettings: (view = 'drafts') => apiRequest(`/settings?view=${encoded(view)}`),
  saveSettings: (content, expectedRevision = 0) => apiRequest('/settings', {
    method: 'PUT',
    body: { content: siteSettingsSchema.parse(content), expectedRevision },
  }),
  publishSettings: (expectedRevision) => apiRequest('/settings/publish', { method: 'POST', body: { expectedRevision } }),
  importImage: (sourceUrl, alt = '', { private: privateUpload = false } = {}) => apiRequest('/media/import', {
    method: 'POST',
    body: { sourceUrl, alt, private: privateUpload },
  }),
  upload: async (file, { kind = 'image', alt = '', replaceMediaId = '', private: privateUpload = false, onProgress = () => {} } = {}) => {
    if (!file) throw new CmsApiError('upload', 'No file was selected.', 400)
    const isResume = kind === 'resume'
    const allowed = isResume ? ['application/pdf'] : ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) throw new CmsApiError('validation', isResume ? 'Choose a PDF resume.' : 'Choose a JPEG, PNG, or WebP image.', 422)

    const signedUpload = await apiRequest('/media/upload-url', {
      method: 'POST',
      body: { kind, fileName: file.name, contentType: file.type },
    })
    if (file.size <= 0 || file.size > signedUpload.maxBytes) {
      throw new CmsApiError('validation', `The file exceeds the ${isResume ? '5 MB' : '12 MB'} upload limit.`, 413)
    }

    onProgress(1)
    await uploadToSignedUrl(file, signedUpload, onProgress)
    onProgress(90)
    const result = await apiRequest('/media/finalize', {
      method: 'POST',
      body: {
        storagePath: signedUpload.storagePath,
        kind,
        alt,
        replaceMediaId,
        private: privateUpload || isResume,
      },
    })
    onProgress(100)
    return result
  },
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
    if (hasProductionCmsProvider && property in productionApi) {
      const value = Reflect.get(productionApi, property, productionApi)
      return typeof value === 'function' ? value.bind(productionApi) : value
    }
    return Reflect.get(target, property, receiver)
  },
})

let apiStatus = isLocalCmsMode()
  ? { state: 'checking', ready: false, storageReady: false, checking: true, label: statusLabels.checking, message: statusLabels.checking, checkedAt: null }
  : hasProductionCmsProvider
    ? { state: 'checking', ready: false, storageReady: false, checking: true, label: statusLabels.checking, message: 'Checking administrator access and persistent production storage…', checkedAt: null }
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

  if (!hasProductionCmsProvider) {
    updateApiStatus({ state: 'unconfigured', ready: false, storageReady: false, checking: false, message: productionMessage, checkedAt: new Date().toISOString() })
    return false
  }

  updateApiStatus({ state: 'checking', ready: false, checking: true, message: 'Checking administrator access and persistent production storage…', checkedAt: apiStatus.checkedAt })
  try {
    const health = await apiRequest('/health')
    const firestoreReady = health?.firestore?.ready === true
    const storageReady = health?.storage?.ready === true
    const ready = health?.ok === true && firestoreReady && storageReady
    const unavailable = [
      !firestoreReady ? health?.firestore?.message || 'Firestore is unavailable.' : '',
      !storageReady ? health?.storage?.message || 'Cloud Storage is unavailable.' : '',
      health?.configuration?.ready === false ? 'The CMS API deployment configuration is incomplete.' : '',
    ].filter(Boolean)
    updateApiStatus({
      state: ready ? 'firebase' : 'serverError',
      ready,
      storageReady,
      storageMessage: health?.storage?.message || '',
      checking: false,
      message: ready
        ? 'Production CMS is connected. Admin writes use the authenticated Firebase API; published changes update the live Firestore subscriptions.'
        : unavailable.join(' '),
      projectId: health?.projectId || '',
      checkedAt: new Date().toISOString(),
    })
    return ready
  } catch (cause) {
    const error = cause instanceof CmsApiError ? cause : new CmsApiError('serverError', 'The production CMS health check failed.')
    updateApiStatus({
      state: error.state === 'unconfigured' ? 'unconfigured' : 'serverError',
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
