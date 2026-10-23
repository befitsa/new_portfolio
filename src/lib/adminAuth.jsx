import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth, authConfigurationError, browserLocalPersistence } from './firebase.js'

export const ADMIN_UID = '0SYXtQtU61hMim2S9a2aktAeeSA2'

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
  return 'Sign-in could not be completed. Check your connection and try again.'
}

export function AdminAuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, error: '' })

  useEffect(() => {
    if (!auth) {
      setState({ loading: false, user: null, error: authConfigurationError })
      return undefined
    }

    let active = true
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return
      if (user && user.uid !== ADMIN_UID) {
        setState({ loading: false, user: null, error: 'This Firebase account is not authorized to access the admin dashboard.' })
        try {
          await signOut(auth)
        } catch {
          if (active) setState({ loading: false, user: null, error: 'This account is not authorized. Sign-out failed; close this tab and try again.' })
        }
        return
      }
      setState((current) => ({ loading: false, user, error: current.error }))
    }, () => {
      if (active) setState({ loading: false, user: null, error: 'Could not verify your sign-in session. Please sign in again.' })
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const value = useMemo(() => ({
    ...state,
    configured: Boolean(auth),
    clearError: () => setState((current) => ({ ...current, error: '' })),
    login: async (username, password) => {
      if (!auth) {
        setState((current) => ({ ...current, error: authConfigurationError }))
        throw new Error(authConfigurationError)
      }
      setState((current) => ({ ...current, error: '' }))
      try {
        await setPersistence(auth, browserLocalPersistence)
        const credential = await signInWithEmailAndPassword(auth, username.trim(), password)
        if (credential.user.uid !== ADMIN_UID) {
          await signOut(auth)
          const error = new Error('This Firebase account is not authorized to access the admin dashboard.')
          error.code = 'admin/unauthorized'
          throw error
        }
        return true
      } catch (error) {
        if (error?.code === 'admin/unauthorized') {
          setState((current) => ({ ...current, error: error.message, user: null }))
          throw error
        }
        const message = friendlyAuthError(error)
        setState((current) => ({ ...current, error: message, user: null }))
        throw new Error(message)
      }
    },
    logout: async () => {
      if (auth) await signOut(auth)
      setState({ loading: false, user: null, error: '' })
    },
  }), [state])

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export function useAdminAuth() {
  const value = useContext(AdminAuthContext)
  if (!value) throw new Error('useAdminAuth must be used inside AdminAuthProvider.')
  return value
}
