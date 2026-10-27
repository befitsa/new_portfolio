const API_ROOT = '/api/public'
const REFRESH_MS = 30_000

function localPath(path) {
  return path.replace(/^\/content\//, '/')
}

async function read(path, signal) {
  if (!import.meta.env.DEV) {
    throw new Error('The local file-based portfolio content is available only in the development server. Local publishing does not update the live website.')
  }
  const response = await fetch(`${API_ROOT}${localPath(path)}`, { cache: 'no-store', signal, headers: { Accept: 'application/json' } })
  let body
  try {
    body = await response.json()
  } catch {
    const contentType = response.headers.get('content-type') || 'an unknown content type'
    if (/html/i.test(contentType)) {
      throw new Error(`The local content API returned a web page instead of JSON (HTTP ${response.status}). Restart the Vite development server and try again.`)
    }
    throw new Error(`The local content API returned an invalid response (HTTP ${response.status}, ${contentType}).`)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, 'data')) {
    throw new Error('The local content API returned an unexpected response. Restart the Vite development server and try again.')
  }
  if (!response.ok) throw new Error(body.error || 'Published portfolio content is temporarily unavailable.')
  return body.data
}

function subscribe(path, onValue, onError) {
  let active = true
  let controller
  let timer
  const refresh = async () => {
    controller?.abort()
    controller = new AbortController()
    try {
      const value = await read(path, controller.signal)
      if (active) onValue(value)
    } catch (error) {
      if (active && error?.name !== 'AbortError') onError(error)
    }
    if (active) timer = window.setTimeout(refresh, REFRESH_MS)
  }
  refresh()
  return () => { active = false; controller?.abort(); window.clearTimeout(timer) }
}

export function subscribeToPublishedCollection(type, onValue, onError) {
  return subscribe(`/content/${encodeURIComponent(type)}`, onValue, onError)
}

export function subscribeToPublishedDocument(type, id, onValue, onError) {
  return subscribe(`/content/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, onValue, onError)
}

export function subscribeToPublishedSiteSettings(onValue, onError) {
  return subscribe('/settings', onValue, onError)
}
