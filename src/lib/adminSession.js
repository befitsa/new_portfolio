export const ADMIN_SESSION_DURATION_MS = 30 * 60 * 1000
export const ADMIN_SESSION_STORAGE_KEY = 'fitsum-admin-session-v1'
export const ADMIN_SESSION_EVENT_KEY = 'fitsum-admin-session-event-v1'
export const ADMIN_SESSION_PENDING_KEY = 'fitsum-admin-session-pending-v1'
export const ADMIN_SESSION_EXPIRED_EVENT = 'fitsum:admin-session-expired'
export const ADMIN_SESSION_EXPIRED_MESSAGE = 'Your admin session expired after 30 minutes. Please sign in again.'
export const ADMIN_SESSION_INVALID_MESSAGE = 'Your admin session could not be verified. Please sign in again.'

function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function createAdminSession(uid, authTime, now = Date.now()) {
  const authenticatedAt = Number(authTime)
  if (!uid || !Number.isFinite(now) || !Number.isSafeInteger(authenticatedAt) || authenticatedAt <= 0) return null
  const expiresAt = authenticatedAt * 1000 + ADMIN_SESSION_DURATION_MS
  if (!Number.isSafeInteger(expiresAt)) return null
  return { uid, authTime: authenticatedAt, expiresAt }
}

export function writeAdminSession(session, storage = browserStorage()) {
  const expected = createAdminSession(session?.uid, session?.authTime)
  if (!storage || !expected || session.expiresAt !== expected.expiresAt) {
    throw new Error(ADMIN_SESSION_INVALID_MESSAGE)
  }
  storage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(session))
  storage.removeItem(ADMIN_SESSION_EVENT_KEY)
  storage.removeItem(ADMIN_SESSION_PENDING_KEY)
}

export function beginAdminLogin(storage = browserStorage()) {
  if (!storage) throw new Error(ADMIN_SESSION_INVALID_MESSAGE)
  storage.setItem(ADMIN_SESSION_PENDING_KEY, JSON.stringify({ startedAt: Date.now() }))
}

export function clearAdminLoginPending(storage = browserStorage()) {
  try { storage?.removeItem(ADMIN_SESSION_PENDING_KEY) } catch {}
}

export function isAdminLoginPending(now = Date.now(), storage = browserStorage()) {
  try {
    const pending = JSON.parse(storage?.getItem(ADMIN_SESSION_PENDING_KEY) || 'null')
    return Number.isFinite(pending?.startedAt) && now - pending.startedAt >= 0 && now - pending.startedAt < 2 * 60 * 1000
  } catch {
    return false
  }
}

export function clearAdminSession(storage = browserStorage()) {
  try { storage?.removeItem(ADMIN_SESSION_STORAGE_KEY) } catch {}
}

export function readAdminSession(uid, authTime, now = Date.now(), storage = browserStorage()) {
  const expected = createAdminSession(uid, authTime)
  if (!expected || !storage || !Number.isFinite(now)) return null
  try {
    const stored = JSON.parse(storage.getItem(ADMIN_SESSION_STORAGE_KEY) || 'null')
    if (
      stored?.uid !== expected.uid
      || stored?.authTime !== expected.authTime
      || stored?.expiresAt !== expected.expiresAt
      || now >= expected.expiresAt
    ) return null
    return expected
  } catch {
    return null
  }
}

export function readCurrentAdminSession(uid, now = Date.now(), storage = browserStorage()) {
  if (!uid || !storage || !Number.isFinite(now)) return null
  try {
    const stored = JSON.parse(storage.getItem(ADMIN_SESSION_STORAGE_KEY) || 'null')
    const expected = createAdminSession(uid, stored?.authTime)
    if (!expected || expected.expiresAt !== stored.expiresAt || now >= expected.expiresAt) return null
    return expected
  } catch {
    return null
  }
}

export function announceAdminSessionEnd(reason, storage = browserStorage()) {
  try {
    storage?.setItem(ADMIN_SESSION_EVENT_KEY, JSON.stringify({ reason, at: Date.now(), nonce: Math.random().toString(36).slice(2) }))
  } catch {}
}

export function readAdminSessionEndReason(storage = browserStorage()) {
  try {
    const event = JSON.parse(storage?.getItem(ADMIN_SESSION_EVENT_KEY) || 'null')
    return ['expired', 'invalid', 'logout'].includes(event?.reason) ? event.reason : ''
  } catch {
    return ''
  }
}

export function assertAdminSession(uid, now = Date.now()) {
  const session = readCurrentAdminSession(uid, now)
  if (session) return session
  const reason = readCurrentAdminSession(uid, 0) ? 'expired' : 'invalid'
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ADMIN_SESSION_EXPIRED_EVENT, { detail: { reason } }))
  }
  const error = new Error(reason === 'expired' ? ADMIN_SESSION_EXPIRED_MESSAGE : ADMIN_SESSION_INVALID_MESSAGE)
  error.status = 401
  throw error
}

export function scheduleAdminSessionExpiry(session, onExpire, {
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let timer
  const checkDeadline = () => {
    const remaining = session.expiresAt - now()
    if (remaining <= 0) onExpire()
    else timer = schedule(checkDeadline, remaining)
  }
  timer = schedule(checkDeadline, Math.max(0, session.expiresAt - now()))
  return () => cancel(timer)
}
