const API_BASE = '/api'

async function request(path, { method = 'GET', body } = {}) {
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Could not reach the local CMS server. Start the app with npm run dev.')
  }
  const text = await response.text()
  let payload
  try { payload = text ? JSON.parse(text) : null } catch { payload = null }
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : `Local CMS request failed (${response.status}).`)
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !payload || !Object.hasOwn(payload, 'data')) {
    throw new Error('Local CMS returned an invalid response. Restart the development server and try again.')
  }
  return payload.data
}

function encoded(value) { return encodeURIComponent(value) }

function upload(file, { kind = 'image', alt = '', replaceMediaId = '', onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
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
    xhr.send(form)
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
