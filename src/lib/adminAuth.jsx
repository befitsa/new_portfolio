import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from './supabase.js'
import { getAdminRecoveryRedirectUrl } from './siteUrls.js'
import { isLocalFilesystemCms } from '../services/cmsProvider.js'

const AdminAuthContext = createContext(null)

function friendlyAuthError(error) {
  const code = error?.code || ''
  if (code === 'invalid_credentials' || code === 'invalid_grant' || code === 'user_not_found') {
    return 'Email or password is incorrect.'
  }
  if (code === 'email_not_confirmed') {
    return 'Confirm the administrator email address in Supabase before signing in.'
  }
  if (code === 'signup_disabled') {
    return 'Administrator sign-in is unavailable. Public sign-up is disabled.'
  }
  if (error?.name === 'AuthRetryableFetchError' || /fetch|network|timeout/i.test(error?.message || '')) {
    return 'Unable to reach Supabase Auth. Check your connection and try again.'
  }
  return error?.message || 'Sign-in could not be completed. Check your connection and try again.'
}

function passwordRecoveryDiagnostic(error) {
  const redactSensitiveValues = (value) => String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/\S+/gi, '[redacted URL]')
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?|[A-Za-z0-9_-]{40,})\b/g, '[redacted token]')
    .slice(0, 240)
  const safeLabel = (value) => typeof value === 'string'
    ? value.replace(/[^\w.-]/g, '').slice(0, 64)
    : ''

  return {
    name: safeLabel(error?.name) || 'AuthError',
    code: safeLabel(error?.code) || 'unknown',
    status: Number.isFinite(error?.status) ? error.status : null,
    message: redactSensitiveValues(error?.message) || 'No error message provided',
  }
}

async function assertRegisteredAdmin(user) {
  if (!user?.id) {
    throw new Error('This Supabase account is not authorized to access the portfolio dashboard.')
  }
  const { data, error } = await supabase.rpc('cms_is_admin')
  if (error) throw new Error(friendlyAuthError(error))
  if (data !== true) {
    throw new Error('This account is not registered as a portfolio administrator.')
  }
  return user
}

export function AdminAuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, error: '' })
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const recoveryActiveRef = useRef(false)

  useEffect(() => {
    const isLocalAuthFlowRoute = /^\/(?:admin\/)?(?:login|reset-password)\/?$/.test(window.location.pathname)
    if (isLocalFilesystemCms && !isLocalAuthFlowRoute) {
      setState({ loading: false, user: { id: 'local-development-admin', uid: 'local-development-admin', displayName: 'Local developer' }, error: '' })
      return undefined
    }
    if (!supabase || !isSupabaseConfigured) {
      setState({ loading: false, user: null, error: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable Supabase Auth.' })
      return undefined
    }

    let active = true
    let requestId = 0
    const resolveSession = async (user) => {
      const currentRequest = ++requestId
      if (!user) {
        if (active && currentRequest === requestId) {
          setState((current) => ({ ...current, loading: false, user: null }))
        }
        return
      }
      setState((current) => ({ ...current, loading: true, error: '' }))
      try {
        const admin = await assertRegisteredAdmin(user)
        if (active && currentRequest === requestId) setState({ loading: false, user: admin, error: '' })
      } catch (error) {
        if (!active || currentRequest !== requestId) return
        let message = error.message
        setState({ loading: false, user: null, error: message })
        try {
          await supabase.auth.signOut()
        } catch {
          message = `${message} The session could not be cleared; sign out manually and try again.`
        }
        if (active && currentRequest === requestId) setState({ loading: false, user: null, error: message })
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        recoveryActiveRef.current = true
        requestId += 1
        setPasswordRecovery(true)
        setState({ loading: false, user: null, error: '' })
        return
      }
      if (recoveryActiveRef.current) {
        if (event === 'SIGNED_OUT' || !session) {
          recoveryActiveRef.current = false
          setPasswordRecovery(false)
          setState({ loading: false, user: null, error: '' })
        } else {
          setState({ loading: false, user: null, error: '' })
        }
        return
      }
      queueMicrotask(() => {
        if (!recoveryActiveRef.current) {
          void resolveSession(session?.user || null)
        }
      })
    })
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) throw error
      if (!recoveryActiveRef.current) {
        return resolveSession(data.session?.user || null)
      }
      setState({ loading: false, user: null, error: '' })
    }).catch((error) => {
      if (active) setState({ loading: false, user: null, error: friendlyAuthError(error) })
    })

    return () => {
      active = false
      requestId += 1
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(() => ({
    ...state,
    passwordRecovery,
    configured: isLocalFilesystemCms || isSupabaseConfigured,
    recoveryAvailable: Boolean(supabase && isSupabaseConfigured),
    clearError: () => setState((current) => ({ ...current, error: '' })),
    requestPasswordReset: async (email) => {
      if (!supabase || !isSupabaseConfigured) {
        throw new Error('Password recovery is available only through the configured Supabase CMS.')
      }
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: getAdminRecoveryRedirectUrl({
            configuredRedirectUrl: import.meta.env.VITE_ADMIN_RECOVERY_REDIRECT_URL,
            publicSiteUrl: import.meta.env.VITE_PUBLIC_PORTFOLIO_URL,
            origin: window.location.origin,
          }),
        })
        if (error) throw error
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('[AdminAuth] Password recovery request failed', passwordRecoveryDiagnostic(error))
        }
        throw new Error(friendlyAuthError(error))
      }
    },
    login: async (email, password) => {
      if (isLocalFilesystemCms) {
        setState({ loading: false, user: { id: 'local-development-admin', uid: 'local-development-admin', displayName: 'Local developer' }, error: '' })
        return true
      }
      if (!supabase || !isSupabaseConfigured) {
        const message = 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable Supabase Auth.'
        setState((current) => ({ ...current, error: message }))
        throw new Error(message)
      }
      setState((current) => ({ ...current, loading: true, error: '' }))
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
        const user = await assertRegisteredAdmin(data.user)
        setState({ loading: false, user, error: '' })
        return true
      } catch (error) {
        let message = friendlyAuthError(error)
        if (error?.message?.includes('not authorized') || error?.message?.includes('not registered')) {
          try {
            await supabase.auth.signOut()
          } catch {
            message = `${message} The session could not be cleared; sign out manually and try again.`
          }
        }
        setState({ loading: false, user: null, error: message })
        throw new Error(message)
      }
    },
    logout: async () => {
      if (!isLocalFilesystemCms && supabase) {
        const { error } = await supabase.auth.signOut()
        if (error) throw new Error(friendlyAuthError(error))
      }
      setState({ loading: false, user: null, error: '' })
    },
  }), [passwordRecovery, state])

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export function useAdminAuth() {
  const value = useContext(AdminAuthContext)
  if (!value) throw new Error('useAdminAuth must be used inside AdminAuthProvider.')
  return value
}
