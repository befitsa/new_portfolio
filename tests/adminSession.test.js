import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADMIN_SESSION_DURATION_MS,
  ADMIN_SESSION_EVENT_KEY,
  ADMIN_SESSION_PENDING_KEY,
  ADMIN_SESSION_STORAGE_KEY,
  beginAdminLogin,
  createAdminSession,
  isAdminLoginPending,
  readAdminSession,
  readAdminSessionEndReason,
  scheduleAdminSessionExpiry,
  writeAdminSession,
} from '../src/lib/adminSession.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test('admin session deadline is fixed to Firebase auth_time and survives reads after reload', () => {
  const storage = memoryStorage()
  const authTime = Math.floor(Date.now() / 1000) - 600
  const session = createAdminSession('admin-1', authTime)
  assert.equal(session.expiresAt, authTime * 1000 + ADMIN_SESSION_DURATION_MS)
  writeAdminSession(session, storage)

  const afterReload = readAdminSession('admin-1', authTime, session.expiresAt - 10 * 60 * 1000, storage)
  assert.deepEqual(afterReload, session)
  assert.equal(storage.getItem(ADMIN_SESSION_STORAGE_KEY), JSON.stringify(session))
  assert.equal(readAdminSession('admin-1', authTime, session.expiresAt, storage), null)
  assert.equal(readAdminSession('admin-2', authTime, session.expiresAt - 1, storage), null)
  assert.equal(readAdminSession('admin-1', authTime - 1, session.expiresAt - 1, storage), null)
})

test('missing, malformed, and altered session deadlines are rejected', () => {
  const storage = memoryStorage()
  const authTime = Math.floor(Date.now() / 1000) - 60
  assert.equal(readAdminSession('admin-1', authTime, authTime * 1000, storage), null)
  storage.setItem(ADMIN_SESSION_STORAGE_KEY, '{broken')
  assert.equal(readAdminSession('admin-1', authTime, authTime * 1000, storage), null)
  storage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify({ uid: 'admin-1', authTime, expiresAt: authTime * 1000 + ADMIN_SESSION_DURATION_MS + 1 }))
  assert.equal(readAdminSession('admin-1', authTime, authTime * 1000, storage), null)
  assert.equal(createAdminSession('admin-1', 'not-a-time'), null)
})

test('session expiry timer uses a fixed deadline and supports fake time', () => {
  let clock = 0
  let nextId = 0
  const timers = new Map()
  const schedule = (callback, delay) => {
    const id = ++nextId
    timers.set(id, { callback, due: clock + delay })
    return id
  }
  const cancel = (id) => timers.delete(id)
  const advance = (duration) => {
    clock += duration
    for (const [id, timer] of [...timers]) {
      if (timer.due <= clock) {
        timers.delete(id)
        timer.callback()
      }
    }
  }
  let expirationCount = 0
  const stop = scheduleAdminSessionExpiry({ expiresAt: ADMIN_SESSION_DURATION_MS }, () => { expirationCount += 1 }, {
    now: () => clock,
    schedule,
    cancel,
  })

  advance(ADMIN_SESSION_DURATION_MS - 1)
  assert.equal(expirationCount, 0)
  advance(1)
  assert.equal(expirationCount, 1)
  stop()
  assert.equal(timers.size, 0)
})

test('cross-tab end events persist enough context to show the expiration message', () => {
  const storage = memoryStorage()
  storage.setItem(ADMIN_SESSION_EVENT_KEY, JSON.stringify({ reason: 'expired' }))
  assert.equal(readAdminSessionEndReason(storage), 'expired')
  storage.setItem(ADMIN_SESSION_EVENT_KEY, JSON.stringify({ reason: 'logout' }))
  assert.equal(readAdminSessionEndReason(storage), 'logout')
  storage.setItem(ADMIN_SESSION_EVENT_KEY, '{broken')
  assert.equal(readAdminSessionEndReason(storage), '')
})

test('a pending login coordinates auth persistence across tabs without extending the deadline', () => {
  const storage = memoryStorage()
  const startedAt = Date.now()
  beginAdminLogin(storage)
  assert.equal(isAdminLoginPending(startedAt + 500, storage), true)
  assert.equal(isAdminLoginPending(startedAt + 2 * 60 * 1000, storage), false)
  assert.ok(storage.getItem(ADMIN_SESSION_PENDING_KEY))

  const session = createAdminSession('admin-1', Math.floor(startedAt / 1000))
  writeAdminSession(session, storage)
  assert.equal(storage.getItem(ADMIN_SESSION_PENDING_KEY), null)
  assert.deepEqual(readAdminSession('admin-1', session.authTime, startedAt + 5 * 60 * 1000, storage), session)
})
