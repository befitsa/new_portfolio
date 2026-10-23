const POLL_INTERVAL = 1200

async function getPublic(path) {
  const response = await fetch(`/api/public/${path}`, { cache: 'no-store', headers: { Accept: 'application/json' } })
  const text = await response.text()
  let payload
  try { payload = text ? JSON.parse(text) : null } catch { payload = null }
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : `Local portfolio content request failed (${response.status}).`)
  if (!payload || !Object.hasOwn(payload, 'data')) throw new Error('Local portfolio content returned an invalid response.')
  return payload.data
}

function subscribe(path, onValue, onError) {
  let active = true
  let timer
  let lastValue
  const poll = async () => {
    try {
      const value = await getPublic(path)
      const serialized = JSON.stringify(value)
      if (active && serialized !== lastValue) {
        lastValue = serialized
        onValue(value)
      }
    } catch (error) {
      if (active) onError(error)
    } finally {
      if (active) timer = window.setTimeout(poll, POLL_INTERVAL)
    }
  }
  void poll()
  return () => {
    active = false
    window.clearTimeout(timer)
  }
}

export function subscribeLocalCmsCollection(type, onValue, onError) {
  return subscribe(encodeURIComponent(type), onValue, onError)
}

export function subscribeLocalCmsDocument(type, id, onValue, onError) {
  return subscribe(`${encodeURIComponent(type)}/${encodeURIComponent(id)}`, onValue, onError)
}

export function subscribeLocalCmsSettings(onValue, onError) {
  return subscribe('settings', onValue, onError)
}
