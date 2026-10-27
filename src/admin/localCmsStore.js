import { auth } from '../lib/firebase.js'

const API_BASE = '/api'

function requestError(message, status = 0) {
  const error = new Error(message)
  error.status = status
  return error
}

async function request(path, { method = 'GET', body } = {}) {
  let token = ''
  try {
    if (auth?.currentUser) token = await auth.currentUser.getIdToken()
  } catch (error) {
    console.error('[Local CMS] Failed to refresh the administrator ID token.', error)
    throw requestError('Your administrator session could not be verified. Sign in again.', 401)
  }
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(token ? { 'X-Firebase-Id-Token': token } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    console.error(`[Local CMS] Network request failed for ${method} ${path}.`, error)
    throw requestError('Could not reach the local CMS server. Start the app with npm run dev.')
  }
  const text = await response.text()
  let payload
  try { payload = text ? JSON.parse(text) : null } catch { payload = null }
  if (!response.ok) throw requestError(typeof payload?.error === 'string' ? payload.error : `Local CMS request failed (${response.status}).`, response.status)
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !payload || !Object.hasOwn(payload, 'data')) {
    throw new Error('Local CMS returned an invalid response. Restart the development server and try again.')
  }
  return payload.data
}

function encoded(value) { return encodeURIComponent(value) }

function upload(file, { kind = 'image', alt = '', replaceMediaId = '', onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const user = auth?.currentUser
    if (!user) {
      reject(new Error('Sign in with the administrator account to continue.'))
      return
    }
    const form = new FormData()
    form.set('kind', kind)
    form.set('alt', alt)
    if (replaceMediaId) form.set('replaceMediaId', replaceMediaId)
    form.set('file', file, file.name)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/media/upload`)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onerror = () => reject(new Error('The local file upload failed. Check that the development server is still running.'))
    xhr.onload = () => {
      let payload
      try { payload = JSON.parse(xhr.responseText) } catch { payload = null }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(typeof payload?.error === 'string' ? payload.error : `Local file upload failed (${xhr.status}).`))
        return
      }
      if (!payload || !Object.hasOwn(payload, 'data')) {
        reject(new Error('The local upload server returned an invalid response.'))
        return
      }
      onProgress(100)
      resolve(payload.data)
    }
    user.getIdToken().then((token) => {
      if (token) xhr.setRequestHeader('X-Firebase-Id-Token', token)
      xhr.send(form)
    }).catch(() => reject(new Error('Your administrator session could not be verified. Sign in again.')))
  })
}

export const localCmsApi = Object.freeze({
  request,
  health: () => request('/health'),
  list: (type, view = 'drafts') => request(`/${encoded(type)}?view=${encoded(view)}`),
  get: (type, id, view = 'drafts') => request(`/${encoded(type)}/${encoded(id)}?view=${encoded(view)}`),
  create: (type, content) => request(`/${encoded(type)}`, { method: 'POST', body: { content } }),
  save: (type, id, content, expectedRevision = 0) => request(`/${encoded(type)}/${encoded(id)}`, { method: 'PUT', body: { content, expectedRevision } }),
  publish: (type, id, expectedRevision) => request(`/${encoded(type)}/${encoded(id)}/publish`, { method: 'POST', body: { expectedRevision } }),
  unpublish: (type, id) => request(`/${encoded(type)}/${encoded(id)}/unpublish`, { method: 'POST' }),
  deleteItem: (type, id) => request(`/${encoded(type)}/${encoded(id)}`, { method: 'DELETE' }),
  reorder: (type, items) => request(`/${encoded(type)}/reorder`, { method: 'PATCH', body: { items } }),
  removeMedia: (id) => request(`/media/${encoded(id)}`, { method: 'DELETE' }),
  getSettings: (view = 'drafts') => request(`/settings?view=${encoded(view)}`),
  saveSettings: (content, expectedRevision = 0) => request('/settings', { method: 'PUT', body: { content, expectedRevision } }),
  publishSettings: (expectedRevision) => request('/settings/publish', { method: 'POST', body: { expectedRevision } }),
  importImage: (sourceUrl, alt = '') => request('/media/import', { method: 'POST', body: { sourceUrl, alt } }),
  upload,
})
