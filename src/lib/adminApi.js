import { useSyncExternalStore } from 'react'
import { auth } from './firebase.js'

export class AdminApiError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'AdminApiError'; this.status = status }
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
    throw new AdminApiError('The Netlify content API could not be reached. Start Netlify Dev locally or check the deployment.')
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new AdminApiError(payload.error || 'The content API request failed.', response.status)
  return payload.data
}

const enc = (value) => encodeURIComponent(value)

export const adminApi = {
  health: () => fetch('/api/health', { cache: 'no-store' }).then(async (response) => {
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new AdminApiError(payload.error || 'API health check failed.', response.status)
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
  signUpload: (kind, fileName) => request('/uploads/sign', { method: 'POST', body: { kind, fileName } }),
  completeUpload: (payload) => request('/uploads/complete', { method: 'POST', body: payload }),
}

export async function uploadMedia(file, kind, onProgress = () => {}) {
  const limits = kind === 'resume' ? { bytes: 5 * 1024 * 1024, types: ['application/pdf'] } : { bytes: 8 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] }
  if (!limits.types.includes(file.type)) throw new Error(kind === 'resume' ? 'Choose a PDF file.' : 'Choose a JPEG, PNG, or WebP image.')
  if (!file.size || file.size > limits.bytes) throw new Error(`File must be smaller than ${Math.floor(limits.bytes / 1024 / 1024)} MB.`)
  const signed = await adminApi.signUpload(kind, file.name)
  const form = new FormData()
  form.append('file', file)
  Object.entries(signed.fields).forEach(([key, value]) => form.append(key, value))
  const result = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', signed.uploadUrl)
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)) }
    xhr.onload = () => {
      let response = {}
      try { response = JSON.parse(xhr.responseText) } catch {}
      if (xhr.status < 200 || xhr.status >= 300) reject(new Error(response.error?.message || 'Cloudinary upload failed.'))
      else resolve(response)
    }
    xhr.onerror = () => reject(new Error('Cloudinary upload failed. Check your network and try again.'))
    xhr.send(form)
  })
  return adminApi.completeUpload({ assetId: result.public_id, kind, bytes: result.bytes, format: result.format, fileName: file.name })
}

let apiStatus = { state: 'checking', ready: false, checking: true, label: 'Checking Netlify API', message: '' }
const listeners = new Set()
export function useAdminApiStatus() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => apiStatus, () => apiStatus)
}
export async function checkAdminApiHealth() {
  apiStatus = { ...apiStatus, state: 'checking', checking: true, label: 'Checking Netlify API' }
  listeners.forEach((listener) => listener())
  try {
    const health = await adminApi.health()
    apiStatus = { state: health.ready ? 'netlify' : 'unconfigured', ready: health.ready, checking: false, label: health.ready ? 'Netlify + Firestore' : 'Setup needed', message: health.message || '' }
  } catch (error) {
    apiStatus = { state: 'unavailable', ready: false, checking: false, label: 'API unavailable', message: error.message }
  }
  listeners.forEach((listener) => listener())
  return apiStatus.ready
}
