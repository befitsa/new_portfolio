import { useEffect, useRef, useState } from 'react'
import { LockKeyhole } from 'lucide-react'
import BrandLink from '../components/common/BrandLink.jsx'
import { useAdminAuth } from '../lib/adminAuth.jsx'
import { isSupabaseConfigured, supabase } from '../lib/supabase.js'
import { adminLoginPath } from './AdminLogin.jsx'

function recoveryLinkHasError() {
  const query = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return query.has('error') || query.has('error_code') || hash.has('error') || hash.has('error_code')
}

export default function AdminPasswordRecovery() {
  const { passwordRecovery } = useAdminAuth()
  const recoveryCompleted = useRef(false)
  const [status, setStatus] = useState(() => recoveryLinkHasError() ? 'invalid' : 'checking')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!passwordRecovery) {
      if (recoveryCompleted.current) return undefined
      if (recoveryLinkHasError()) {
        setStatus('invalid')
        setMessage('This password recovery link is invalid or has expired. Request a new link to continue.')
      } else {
        setStatus('invalid')
        setMessage('Open this page using the secure password recovery link sent to your administrator email.')
      }
      return undefined
    }

    let active = true
    setStatus('checking')
    setMessage('')

    const verifyRecoverySession = async () => {
      try {
        if (!supabase || !isSupabaseConfigured) {
          throw new Error('Supabase Auth is unavailable.')
        }
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (!sessionData.session?.user) throw new Error('Recovery session is unavailable.')

        const { data: isAdmin, error: adminError } = await supabase.rpc('cms_is_admin')
        if (adminError) throw adminError
        if (isAdmin !== true) {
          await supabase.auth.signOut()
          throw new Error('This account is not authorized to manage the portfolio.')
        }

        if (!active) return
        window.history.replaceState(window.history.state, '', window.location.pathname)
        setStatus('ready')
      } catch {
        if (!active) return
        if (supabase) await supabase.auth.signOut().catch(() => {})
        setStatus('invalid')
        setMessage('This recovery link could not be verified or is no longer valid. Request a new link and try again.')
      }
    }

    void verifyRecoverySession()
    return () => { active = false }
  }, [passwordRecovery])

  const returnToLogin = () => window.location.replace(adminLoginPath())

  const submit = async (event) => {
    event.preventDefault()
    setMessage('')
    if (password.length < 8) {
      setMessage('Choose a password with at least 8 characters.')
      return
    }
    if (password !== confirmation) {
      setMessage('The passwords do not match.')
      return
    }
    if (!supabase || !isSupabaseConfigured || !passwordRecovery || status !== 'ready') {
      setStatus('invalid')
      setMessage('This recovery link could not be verified or is no longer valid. Request a new link and try again.')
      return
    }

    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      recoveryCompleted.current = true
      setPassword('')
      setConfirmation('')
      try {
        const { error: signOutError } = await supabase.auth.signOut()
        if (signOutError) throw signOutError
        setStatus('success')
        setMessage('Your password has been updated. Sign in with your new password to continue.')
      } catch {
        setStatus('signout-required')
        setMessage('Your password has been updated. Sign out securely before returning to Admin Login.')
      }
    } catch (error) {
      setMessage(error?.message || 'The password could not be updated. Request a new recovery link and try again.')
    } finally {
      setBusy(false)
    }
  }

  const signOutAndReturn = async () => {
    setBusy(true)
    setMessage('')
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      returnToLogin()
    } catch {
      setMessage('The password was updated, but this session could not be cleared. Please retry before returning to login.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="cms-login-page" aria-labelledby="password-recovery-title">
      <section className="cms-login-card">
        <BrandLink className="cms-brand cms-login-brand" href="/" ariaLabel="Fitsum portfolio home" logoSize={44} />
        <p className="cms-eyebrow">SECURE ADMINISTRATION</p>
        <h1 id="password-recovery-title">Choose a new password</h1>
        <p className="cms-login-intro">Password recovery is available only through a valid link sent to a registered administrator email.</p>

        {status === 'checking' && <p className="cms-recovery-status" role="status">Verifying your secure recovery link…</p>}
        {status === 'ready' && (
          <form className="cms-login-form" onSubmit={submit} noValidate>
            <label htmlFor="new-admin-password">New password</label>
            <div className="cms-login-input-wrap">
              <LockKeyhole size={17} aria-hidden="true" />
              <input id="new-admin-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} minLength={8} required />
            </div>
            <label htmlFor="confirm-admin-password">Confirm new password</label>
            <div className="cms-login-input-wrap">
              <LockKeyhole size={17} aria-hidden="true" />
              <input id="confirm-admin-password" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} minLength={8} required />
            </div>
            {message && <p className="cms-login-error" role="alert">{message}</p>}
            <button className="cms-login-submit" type="submit" disabled={busy}>
              {busy ? 'Updating password…' : 'Update password'}
            </button>
          </form>
        )}
        {status === 'invalid' && <div className="cms-recovery-status" role="alert">
          <p>{message}</p>
          <button type="button" className="cms-text-link" onClick={returnToLogin}>Return to Admin Login</button>
        </div>}
        {status === 'success' && <div className="cms-recovery-status" role="status">
          <p>{message}</p>
          <button type="button" className="cms-login-submit" onClick={returnToLogin}>Return to Admin Login</button>
        </div>}
        {status === 'signout-required' && <div className="cms-recovery-status" role="alert">
          <p>{message}</p>
          <button type="button" className="cms-login-submit" onClick={signOutAndReturn} disabled={busy}>
            {busy ? 'Signing out…' : 'Sign out and return to login'}
          </button>
        </div>}
      </section>
    </main>
  )
}
