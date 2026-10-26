const API_ROOT = '/api/public'
const REFRESH_MS = 30_000

async function read(path, signal) {
  const response = await fetch(`${API_ROOT}${path}`, { cache: 'default', signal, headers: { Accept: 'application/json' } })
  const body = await response.json().catch(() => ({}))
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
