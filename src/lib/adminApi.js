import { useSyncExternalStore } from 'react'
import { localCmsApi } from '../admin/localCmsStore.js'
import { isPathBasedAdmin } from '../admin/cmsPaths.js'
import { auth } from './firebase.js'

const configuredBase = import.meta.env.DEV ? import.meta.env.VITE_CMS_API_URL?.trim() : ''
const base = (configuredBase || '/api').replace(/\/$/, '')

const statusLabels = {
  checking: 'Checking CMS API…',
  local: 'Local browser content',
  connected: 'Access API ready',
  unconfigured: 'CMS API not configured',
  network: 'CMS API unreachable',
  notFound: 'CMS API route missing',
  unauthorized: 'Administrator sign-in required',
  forbidden: 'Administrator access denied',
  serverError: 'CMS API server error',
  invalidResponse: 'CMS API returned an invalid response',
}

export function isLocalCmsMode() {
  return import.meta.env.DEV && isPathBasedAdmin()
}

let apiStatus = isLocalCmsMode()
  ? { state: 'local', ready: true, storageReady: true, checking: false, label: statusLabels.local, message: 'Development mode: edits are saved in this browser and are not published to the live website.', checkedAt: new Date().toISOString() }
  : { state: 'checking', ready: false, storageReady: false, checking: true, label: statusLabels.checking, message: statusLabels.checking, checkedAt: null }
const statusListeners = new Set()

function updateApiStatus(next) {
  const defaultLabel = next.state === 'connected' && next.storageReady === false
    ? 'API ready · storage unavailable'
    : statusLabels[next.state] || 'CMS API error'
  apiStatus = { ...next, label: next.label || defaultLabel }
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

function apiErrorForStatus(status, message = '') {
  if (status === 401) return new CmsApiError('unauthorized', 'Administrator sign-in is required. Sign in again with the authorized Firebase account.', status)
  if (status === 403) return new CmsApiError('forbidden', 'Administrator access was denied. Verify the Firebase account and Cloudflare Access policy.', status)
  if (status === 404) return new CmsApiError('notFound', 'The CMS API route returned 404. Check the Netlify /api function route and configured Cloudflare Worker.', status)
  if (status === 503 && /cms api proxy is not configured/i.test(message)) {
    return new CmsApiError('unconfigured', 'The Netlify CMS proxy is not configured. Set the private Function variables CMS_WORKER_URL, CF_ACCESS_CLIENT_ID, and CF_ACCESS_CLIENT_SECRET, then redeploy.', status)
  }
  if (status === 503 && /cloudflare access verification is not configured/i.test(message)) {
    return new CmsApiError('unconfigured', 'The CMS backend is missing its Cloudflare Access configuration. Verify CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD in the Firebase Function environment.', status)
  }
  if (status === 503 && /cms firestore is unavailable/i.test(message)) {
    return new CmsApiError('serverError', 'The CMS API is reachable, but Firestore is unavailable. Check the content project and Function service-account access.', status)
  }
  if (status >= 500) return new CmsApiError('serverError', `CMS API returned ${status}. Check the Functions configuration and server logs.`, status)
  return new CmsApiError('serverError', message || `CMS request failed (${status}).`, status)
}

function parseJson(text) {
  try { return { value: text ? JSON.parse(text) : null, valid: true } }
  catch { return { value: null, valid: false } }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const user = auth?.currentUser
  if (!user) throw new CmsApiError('unauthorized', 'Sign in with the authorized Firebase administrator account to use the CMS.', 401)
  let idToken
  try {
    idToken = await user.getIdToken()
  } catch {
    throw new CmsApiError('unauthorized', 'Your administrator session could not be verified. Sign in again.', 401)
  }
  let response
  try {
    response = await fetch(`${base}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'X-Firebase-Id-Token': idToken,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new CmsApiError('network', 'Could not reach the CMS API. Check the API hostname, DNS, network, and CORS settings.')
  }

  const text = await response.text()
  const { value: payload, valid } = parseJson(text)
  if (!response.ok) {
    const detail = typeof payload?.error === 'string' ? payload.error : text.slice(0, 300)
    const classified = apiErrorForStatus(response.status, detail)
    if (response.status >= 400 && response.status < 500 && !['unconfigured', 'notFound', 'unauthorized', 'forbidden'].includes(classified.state) && detail) {
      classified.message = detail
    }
    throw classified
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !valid || !payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'data')) {
    throw new CmsApiError('invalidResponse', 'The CMS endpoint returned a successful HTTP status but not the expected JSON API response. Check the Netlify /api function and Cloudflare Worker configuration.')
  }
  return payload.data
}

const encoded = (value) => encodeURIComponent(value)

const remoteAdminApi = {
  request,
  health: async () => {
    const data = await request('/health')
    if (data?.ok !== true || data?.access !== 'verified' || data?.administrator !== 'verified' || data?.firestore?.ready !== true || typeof data?.storage?.ready !== 'boolean') {
      throw new CmsApiError('invalidResponse', 'CMS health check did not confirm administrator access and Firestore readiness.')
    }
    return data
  },
  list: (type, view = 'drafts') => request(`/${encoded(type)}?view=${encoded(view)}`),
  get: (type, id, view = 'drafts') => request(`/${encoded(type)}/${encoded(id)}?view=${encoded(view)}`),
  create: (type, content) => request(`/${encoded(type)}`, { method: 'POST', body: { content } }),
  save: (type, id, content, expectedRevision = 0) => request(`/${encoded(type)}/${encoded(id)}`, { method: 'PUT', body: { content, expectedRevision } }),
  publish: (type, id, expectedRevision) => request(`/${encoded(type)}/${encoded(id)}/publish`, { method: 'POST', body: { expectedRevision } }),
  unpublish: (type, id) => request(`/${encoded(type)}/${encoded(id)}/unpublish`, { method: 'POST', body: {} }),
  deleteItem: (type, id) => request(`/${encoded(type)}/${encoded(id)}`, { method: 'DELETE' }),
  reorder: (type, items) => request(`/${encoded(type)}/reorder`, { method: 'PATCH', body: { items } }),
  removeMedia: (id) => request(`/media/${encoded(id)}`, { method: 'DELETE' }),
  getSettings: (view = 'drafts') => request(`/settings?view=${encoded(view)}`),
  saveSettings: (content, expectedRevision = 0) => request('/settings', { method: 'PUT', body: { content, expectedRevision } }),
  publishSettings: (expectedRevision) => request('/settings/publish', { method: 'POST', body: { expectedRevision } }),
  importImage: (sourceUrl, alt = '') => request('/media/import', { method: 'POST', body: { sourceUrl, alt } }),
  upload: async (file, { kind = 'image', alt = '', replaceMediaId = '', onProgress = () => {} } = {}) => {
    const session = await request('/media/upload-url', {
      method: 'POST',
      body: { kind, fileName: file.name, contentType: kind === 'resume' ? 'application/pdf' : file.type },
    })
    if (file.size > session.maxBytes) throw new Error(`File exceeds the ${kind === 'resume' ? '5 MB' : '12 MB'} size limit.`)
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', session.url)
      for (const [name, value] of Object.entries(session.requiredHeaders || {})) xhr.setRequestHeader(name, value)
      xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)) }
      xhr.onerror = () => reject(new CmsApiError('network', 'Storage upload could not reach the file service. Check network and bucket CORS settings.'))
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new CmsApiError(xhr.status === 401 ? 'unauthorized' : xhr.status === 403 ? 'forbidden' : xhr.status >= 500 ? 'serverError' : 'invalidResponse', `Storage upload failed (${xhr.status}).`, xhr.status))
      xhr.send(file)
    })
    return request('/media/finalize', {
      method: 'POST',
      body: { storagePath: session.storagePath, kind, alt, ...(replaceMediaId ? { replaceMediaId } : {}) },
    })
  },
}

// Keep the existing remote API as the production implementation. Local demo
// mode swaps only this client boundary, so the CMS pages use the same methods.
export const adminApi = new Proxy(remoteAdminApi, {
  get(target, property, receiver) {
    if (isLocalCmsMode() && property in localCmsApi) {
      const value = Reflect.get(localCmsApi, property, localCmsApi)
      return typeof value === 'function' ? value.bind(localCmsApi) : value
    }
    return Reflect.get(target, property, receiver)
  },
})

export async function checkCmsApiHealth() {
  if (isLocalCmsMode()) {
    updateApiStatus({ state: 'checking', ready: false, checking: true, message: 'Loading local portfolio content…', checkedAt: apiStatus.checkedAt })
    try {
      const health = await localCmsApi.health()
      const note = health.recoveryNotice ? ` ${health.recoveryNotice}` : ''
      updateApiStatus({ state: 'local', ready: true, storageReady: true, checking: false, message: `Development mode: changes are saved in this browser and are not published to the live website.${note}`, checkedAt: new Date().toISOString() })
      return true
    } catch (cause) {
      const error = cause instanceof CmsApiError
        ? cause
        : new CmsApiError('serverError', cause?.message || 'Local portfolio storage could not be opened.')
      updateApiStatus({ state: error.state, ready: false, checking: false, message: `${error.message} The admin interface remains available in read-only mode.`, checkedAt: new Date().toISOString() })
      return false
    }
  }
  updateApiStatus({ state: 'checking', ready: false, checking: true, message: statusLabels.checking, checkedAt: apiStatus.checkedAt })
  try {
    const health = await adminApi.health()
    const storageReady = health.storage.ready
    const storageMessage = storageReady ? '' : ` Cloud Storage is not ready: ${health.storage.message}`
    updateApiStatus({ state: 'connected', ready: true, storageReady, storageMessage: health.storage.message, checking: false, message: `Firebase administrator identity, Cloudflare Access, and Firestore are verified.${storageMessage}`, checkedAt: new Date().toISOString() })
    return true
  } catch (cause) {
    const error = cause instanceof CmsApiError
      ? cause
      : new CmsApiError('serverError', cause?.message || 'CMS health check failed.')
    updateApiStatus({ state: error.state, ready: false, checking: false, message: error.message, checkedAt: new Date().toISOString() })
    return false
  }
}
