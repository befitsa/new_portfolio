import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth, authConfigurationError, browserLocalPersistence } from './firebase.js'
import {
  ADMIN_SESSION_EVENT_KEY,
  ADMIN_SESSION_EXPIRED_EVENT,
  ADMIN_SESSION_EXPIRED_MESSAGE,
  ADMIN_SESSION_INVALID_MESSAGE,
  ADMIN_SESSION_PENDING_KEY,
  ADMIN_SESSION_STORAGE_KEY,
  announceAdminSessionEnd,
  beginAdminLogin,
  clearAdminLoginPending,
  clearAdminSession,
  createAdminSession,
  readAdminSession,
  readAdminSessionEndReason,
  readCurrentAdminSession,
  isAdminLoginPending,
  scheduleAdminSessionExpiry,
  writeAdminSession,
} from './adminSession.js'

export const ADMIN_UIDS = Object.freeze((import.meta.env.VITE_ADMIN_UIDS || '0SYXtQtU61hMim2S9a2aktAeeSA2').split(',').map((value) => value.trim()).filter(Boolean))
export const ADMIN_UID = ADMIN_UIDS[0] || ''
const isAdminUid = (uid) => ADMIN_UIDS.includes(uid)

const AdminAuthContext = createContext(null)

function friendlyAuthError(error) {
  if (['auth/operation-not-allowed'].includes(error?.code)) {
    return 'Email/Password sign-in is disabled. Enable it in Firebase Console under Authentication → Sign-in method.'
  }
  if (['auth/unauthorized-domain', 'auth/app-not-authorized'].includes(error?.code)) {
    return 'This admin site is not authorized for Firebase Authentication. Add its hostname under Firebase Authentication → Settings → Authorized domains.'
  }
  if (['auth/api-key-not-valid', 'auth/invalid-api-key'].includes(error?.code)) {
    return 'The Firebase API key is invalid. Copy the Web API key from the registered user-auth-vp app in Firebase Console.'
  }
  if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-email', 'auth/user-disabled'].includes(error?.code)) {
    return 'Username or password is incorrect.'
  }
  if (['auth/network-request-failed', 'auth/timeout'].includes(error?.code)) {
    return 'Unable to reach the authentication service. Check your connection and try again.'
  }
  return error?.message || 'Sign-in could not be completed. Check your connection and try again.'
}

function endMessage(reason) {
  if (reason === 'expired') return ADMIN_SESSION_EXPIRED_MESSAGE
  if (reason === 'invalid') return ADMIN_SESSION_INVALID_MESSAGE
  return ''
}

export function AdminAuthProvider({ children }) {
  const [state, setState] = useState(() => {
    const reason = readAdminSessionEndReason()
    return { loading: true, user: null, error: endMessage(reason) }
  })
  const endingSession = useRef(false)
  const pendingLogin = useRef(false)
  const cancelExpiryTimer = useRef(null)

  const endSession = useCallback(async (reason = 'invalid', broadcast = true) => {
    if (endingSession.current) return
    endingSession.current = true
    cancelExpiryTimer.current?.()
    cancelExpiryTimer.current = null
    if (broadcast) announceAdminSessionEnd(reason)
    clearAdminSession()
    clearAdminLoginPending()
    setState({ loading: false, user: null, error: endMessage(reason) })
    if (auth) {
      try { await signOut(auth) } catch {}
    }
  }, [])

  const armExpiryTimer = useCallback((session) => {
    cancelExpiryTimer.current?.()
    cancelExpiryTimer.current = scheduleAdminSessionExpiry(session, () => {
      const current = auth?.currentUser && readCurrentAdminSession(auth.currentUser.uid, 0)
      if (current?.expiresAt === session.expiresAt && auth?.currentUser?.uid === session.uid) {
        void endSession('expired')
      }
    })
  }, [endSession])

  useEffect(() => {
    if (!auth) {
      setState({ loading: false, user: null, error: authConfigurationError })
      return undefined
    }

    let active = true
    let checkNumber = 0
    const validateUserSession = async (user, showLoading = true) => {
      if (!active || pendingLogin.current || isAdminLoginPending()) return
      const currentCheck = ++checkNumber
      if (showLoading) setState((current) => ({ loading: true, user: null, error: current.error }))
      try {
        const token = await user.getIdTokenResult()
        if (!active || currentCheck !== checkNumber || pendingLogin.current) return
        if (!isAdminUid(user.uid)) {
          clearAdminSession()
          endingSession.current = true
          setState({ loading: false, user: null, error: 'This Firebase account is not authorized to access the admin dashboard.' })
          await signOut(auth)
          return
        }
        const session = readAdminSession(user.uid, token.claims.auth_time)
        if (!session) {
          const reason = readAdminSession(user.uid, token.claims.auth_time, 0) ? 'expired' : 'invalid'
          await endSession(reason)
          return
        }
        endingSession.current = false
        armExpiryTimer(session)
        setState({ loading: false, user, error: '' })
      } catch {
        if (active && currentCheck === checkNumber) await endSession('invalid')
      }
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!active || pendingLogin.current) return
      if (!user) {
        checkNumber += 1
        cancelExpiryTimer.current?.()
        cancelExpiryTimer.current = null
        clearAdminSession()
        setState((current) => ({ loading: false, user: null, error: current.error }))
        return
      }
      void validateUserSession(user)
    }, () => {
      if (active) void endSession('invalid')
    })

    const handleExpiredSignal = (event) => {
      void endSession(event.detail?.reason === 'expired' ? 'expired' : 'invalid', false)
    }
    const handleStorage = (event) => {
      if (event.key === ADMIN_SESSION_EVENT_KEY && event.newValue) {
        const reason = readAdminSessionEndReason()
        if (reason) void endSession(reason, false)
      } else if (event.key === ADMIN_SESSION_STORAGE_KEY && event.newValue === null && !endingSession.current) {
        const reason = readAdminSessionEndReason() || 'invalid'
        void endSession(reason, false)
      } else if (event.key === ADMIN_SESSION_PENDING_KEY && event.newValue === null && auth.currentUser) {
        void validateUserSession(auth.currentUser)
      }
    }
    const recheckWhenActive = () => {
      if (document.visibilityState === 'hidden' || pendingLogin.current || isAdminLoginPending()) return
      const user = auth.currentUser
      if (!user) return
      const localSession = readCurrentAdminSession(user.uid)
      if (!localSession) {
        const reason = readCurrentAdminSession(user.uid, 0) ? 'expired' : 'invalid'
        void endSession(reason)
        return
      }
      void user.getIdTokenResult().then((token) => {
        if (!active || pendingLogin.current || auth.currentUser?.uid !== user.uid) return
        const verified = readAdminSession(user.uid, token.claims.auth_time)
        if (!verified) {
          const reason = readAdminSession(user.uid, token.claims.auth_time, 0) ? 'expired' : 'invalid'
          void endSession(reason)
        } else {
          armExpiryTimer(verified)
        }
      }).catch(() => { void endSession('invalid') })
    }

    window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, handleExpiredSignal)
    window.addEventListener('storage', handleStorage)
    window.addEventListener('focus', recheckWhenActive)
    window.addEventListener('pageshow', recheckWhenActive)
    document.addEventListener('visibilitychange', recheckWhenActive)

    return () => {
      active = false
      unsubscribe()
      cancelExpiryTimer.current?.()
      cancelExpiryTimer.current = null
      window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, handleExpiredSignal)
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('focus', recheckWhenActive)
      window.removeEventListener('pageshow', recheckWhenActive)
      document.removeEventListener('visibilitychange', recheckWhenActive)
    }
  }, [armExpiryTimer, endSession])

  const value = useMemo(() => ({
    ...state,
    configured: Boolean(auth),
    clearError: () => setState((current) => ({ ...current, error: '' })),
    login: async (username, password) => {
      if (!auth) {
        setState((current) => ({ ...current, error: authConfigurationError }))
        throw new Error(authConfigurationError)
      }
      pendingLogin.current = true
      endingSession.current = false
      setState((current) => ({ ...current, error: '' }))
      try {
        beginAdminLogin()
        // Keep Firebase's cross-tab auth state; the immutable auth_time deadline gates every restored session.
        await setPersistence(auth, browserLocalPersistence)
        const credential = await signInWithEmailAndPassword(auth, username.trim(), password)
        if (!isAdminUid(credential.user.uid)) {
          await signOut(auth)
          const error = new Error('This Firebase account is not authorized to access the admin dashboard.')
          error.code = 'admin/unauthorized'
          throw error
        }
        const token = await credential.user.getIdTokenResult()
        const session = createAdminSession(credential.user.uid, token.claims.auth_time)
        if (!session || Date.now() >= session.expiresAt) throw new Error(ADMIN_SESSION_INVALID_MESSAGE)
        writeAdminSession(session)
        armExpiryTimer(session)
        endingSession.current = false
        setState({ loading: false, user: credential.user, error: '' })
        return true
      } catch (error) {
        clearAdminSession()
        if (auth.currentUser) {
          try { await signOut(auth) } catch {}
        }
        if (error?.code === 'admin/unauthorized') {
          setState({ loading: false, user: null, error: error.message })
          throw error
        }
        const message = friendlyAuthError(error)
        setState({ loading: false, user: null, error: message })
        throw new Error(message)
      } finally {
        pendingLogin.current = false
        clearAdminLoginPending()
      }
    },
    logout: async () => {
      await endSession('logout')
    },
  }), [state, endSession, armExpiryTimer])

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export function useAdminAuth() {
  const value = useContext(AdminAuthContext)
  if (!value) throw new Error('useAdminAuth must be used inside AdminAuthProvider.')
  return value
}
