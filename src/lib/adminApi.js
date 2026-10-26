import { useSyncExternalStore } from 'react'
import { auth } from './firebase.js'

export class AdminApiError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'AdminApiError'; this.status = status }
}

async function readApiPayload(response) {
  let payload
  try {
    payload = await response.json()
  } catch {
    const contentType = response.headers.get('content-type') || 'an unknown content type'
    const message = /html/i.test(contentType)
      ? `The portfolio API returned a web page instead of JSON (HTTP ${response.status}). Check that Cloudflare Pages has deployed its /api Function routes.`
      : `The portfolio API returned an invalid response (HTTP ${response.status}, ${contentType}). Check the deployment and try again.`
    throw new AdminApiError(message, response.ok ? 502 : response.status)
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AdminApiError('The portfolio service returned an unexpected response. Check the deployment and try again.', response.ok ? 502 : response.status)
  }
  return payload
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const user = auth?.currentUser
  if (!user) throw new AdminApiError('Sign in with the administrator account to continue.', 401)
  const token = await user.getIdToken()
  let response
  try {
    response = await fetch(`/api/admin${path}`, {
      method, signal, cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Firebase-Id-Token': token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new AdminApiError('The portfolio API could not be reached. Check the Cloudflare Pages Function and configured API origin.')
  }
  const payload = await readApiPayload(response)
  if (!response.ok) throw new AdminApiError(payload.error || 'The content API request failed.', response.status)
  if (!Object.hasOwn(payload, 'data')) throw new AdminApiError('The portfolio service returned an unexpected response. Check the deployment and try again.', 502)
  return payload.data
}

const enc = (value) => encodeURIComponent(value)

export const adminApi = {
  health: () => fetch('/api/health', { cache: 'no-store' }).then(async (response) => {
    const payload = await readApiPayload(response)
    if (!response.ok) throw new AdminApiError(payload.error || 'API health check failed.', response.status)
    if (!payload.data || typeof payload.data.ready !== 'boolean') throw new AdminApiError('The portfolio service returned an unexpected response. Check the deployment and try again.', 502)
    return payload.data
  }),
  list: (type) => request(`/content/${enc(type)}`),
  get: (type, id) => request(`/content/${enc(type)}/${enc(id)}`),
  create: (type, content) => request(`/content/${enc(type)}`, { method: 'POST', body: { content } }),
  save: (type, id, content, expectedRevision) => request(`/content/${enc(type)}/${enc(id)}`, { method: 'PUT', body: { content, expectedRevision } }),
  publish: (type, id, expectedRevision) => request(`/content/${enc(type)}/${enc(id)}/publish`, { method: 'POST', body: { expectedRevision } }),
  unpublish: (type, id) => request(`/content/${enc(type)}/${enc(id)}/unpublish`, { method: 'POST' }),
  delete: (type, id) => request(`/content/${enc(type)}/${enc(id)}`, { method: 'DELETE' }),
  reorder: (type, ids) => request(`/content/${enc(type)}/reorder`, { method: 'PATCH', body: { ids } }),
  getSettings: () => request('/settings'),
  saveSettings: (content, expectedRevision) => request('/settings', { method: 'PUT', body: { content, expectedRevision } }),
  publishSettings: (expectedRevision) => request('/settings/publish', { method: 'POST', body: { expectedRevision } }),
}

export async function uploadMedia(file, kind, onProgress = () => {}) {
  const limits = kind === 'resume' ? { bytes: 5 * 1024 * 1024, types: ['application/pdf'] } : { bytes: 8 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] }
  if (!limits.types.includes(file.type)) throw new Error(kind === 'resume' ? 'Choose a PDF file.' : 'Choose a JPEG, PNG, or WebP image.')
  if (!file.size || file.size > limits.bytes) throw new Error(`File must be smaller than ${Math.floor(limits.bytes / 1024 / 1024)} MB.`)
  const user = auth?.currentUser
  if (!user) throw new AdminApiError('Sign in with the administrator account to continue.', 401)
  const token = await user.getIdToken()
  const result = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/admin/uploads?kind=${encodeURIComponent(kind)}`)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.setRequestHeader('Content-Type', file.type)
    xhr.setRequestHeader('X-Firebase-Id-Token', token)
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name))
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)) }
    xhr.onload = () => {
      let response
      try { response = JSON.parse(xhr.responseText) } catch {
        reject(new AdminApiError(`The portfolio upload API returned an invalid response (HTTP ${xhr.status}).`))
        return
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new AdminApiError(response.error || 'The portfolio file could not be uploaded.', xhr.status))
      } else if (!Object.hasOwn(response, 'data')) {
        reject(new AdminApiError('The portfolio upload API returned an unexpected response.', 502))
      } else resolve(response.data)
    }
    xhr.onerror = () => reject(new AdminApiError('The portfolio upload API could not be reached. Check your connection and try again.'))
    xhr.send(file)
  })
  return result
}

let apiStatus = { state: 'checking', ready: false, checking: true, label: 'Checking connection', message: '' }
const listeners = new Set()
export function useAdminApiStatus() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => apiStatus, () => apiStatus)
}
export async function checkAdminApiHealth() {
  apiStatus = { state: 'checking', ready: false, checking: true, label: 'Checking connection', message: '' }
  listeners.forEach((listener) => listener())
  try {
    const health = await adminApi.health()
    apiStatus = health.ready
      ? { state: 'ready', ready: true, checking: false, label: 'Services connected', message: 'Portfolio data and file storage are available.' }
      : { state: 'unconfigured', ready: false, checking: false, label: 'Setup needed', message: 'Portfolio data and file storage are not configured for this site yet.' }
  } catch (error) {
    apiStatus = error?.status === 503
      ? { state: 'unconfigured', ready: false, checking: false, label: 'Setup needed', message: error.message }
      : { state: 'unavailable', ready: false, checking: false, label: 'Connection unavailable', message: error?.status === 502 ? error.message : 'The portfolio service could not be reached. Check the API deployment and try again.' }
  }
  listeners.forEach((listener) => listener())
  return apiStatus.ready
}
