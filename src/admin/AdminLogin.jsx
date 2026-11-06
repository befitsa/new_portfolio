import { useState } from 'react'
import { Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react'
import { useAdminAuth } from '../lib/adminAuth.jsx'
import BrandLink from '../components/common/BrandLink.jsx'
import { isLocalFilesystemCms } from '../services/cmsProvider.js'

export function adminLoginPath() {
  return /^\/admin(?:\/|$)/.test(window.location.pathname) ? '/admin/login' : '/login'
}

export function adminHomePath() {
  return /^\/admin(?:\/|$)/.test(window.location.pathname) ? '/admin' : '/'
}

export function safeAdminReturnPath(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return adminHomePath()
  if (/^\/(?:admin\/)?login(?:\/|$)/.test(value)) return adminHomePath()
  if (/^\/admin(?:\/|$)/.test(window.location.pathname) && !/^\/admin(?:\/|$)/.test(value)) return adminHomePath()
  return value
}

export default function AdminLogin({ onSuccess }) {
  const { login, requestPasswordReset, error: authError, clearError, configured, recoveryAvailable } = useAdminAuth()
  const localMode = isLocalFilesystemCms
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [recoverySent, setRecoverySent] = useState(false)
  const message = formError || authError

  const submit = async (event) => {
    event.preventDefault()
    setFormError('')
    clearError()
    if (!localMode && (!username.trim() || !password)) {
      setFormError('Enter both your administrator email and password.')
      return
    }
    setBusy(true)
    try {
      await login(username, password)
      onSuccess()
    } catch {
      // The auth provider exposes only a safe, user-facing error.
    } finally {
      setBusy(false)
    }
  }

  const requestRecovery = async (event) => {
    event.preventDefault()
    setFormError('')
    clearError()
    if (!username.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username.trim())) {
      setFormError('Enter a valid administrator email address.')
      return
    }
    setBusy(true)
    try {
      await requestPasswordReset(username)
      setRecoverySent(true)
    } catch {
      setFormError('We could not process that request right now. Please try again later.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="cms-login-page" aria-labelledby="admin-login-title">
      <section className="cms-login-card">
        <BrandLink className="cms-brand cms-login-brand" href="/" ariaLabel="Fitsum portfolio home" logoSize={44} />
        <p className="cms-eyebrow">{localMode ? 'LOCAL DEVELOPMENT' : 'SECURE ADMINISTRATION'}</p>
        <h1 id="admin-login-title">{recoveryMode ? 'Reset your password' : 'Admin Login'}</h1>
        <p className="cms-login-intro">{recoveryMode
          ? 'Enter your administrator email and we’ll send a secure password reset link if an account is eligible.'
          : localMode ? 'Local development CMS. No cloud account or service is used.' : 'Sign in with the registered Supabase administrator account to manage the portfolio.'}</p>

        {recoveryMode ? (recoverySent ? (
          <div className="cms-recovery-status" role="status">
            <p>If an administrator account exists for that email, a password reset link will be sent shortly.</p>
            <button type="button" className="cms-text-link" onClick={() => { setRecoveryMode(false); setRecoverySent(false); setFormError('') }}>
              Return to Admin Login
            </button>
          </div>
        ) : (
        <form className="cms-login-form" onSubmit={requestRecovery} noValidate>
          <label htmlFor="recovery-email">Email address</label>
          <div className="cms-login-input-wrap">
            <UserRound size={17} aria-hidden="true" />
            <input id="recovery-email" type="email" autoComplete="email" inputMode="email" placeholder="Administrator email" value={username} onChange={(event) => setUsername(event.target.value)} disabled={!configured || busy} required />
          </div>
          {formError && <p className="cms-login-error" role="alert">{formError}</p>}
          <button className="cms-login-submit" type="submit" disabled={!configured || busy}>
            {busy ? 'Sending reset link…' : 'Send reset link'}
          </button>
          <button type="button" className="cms-text-link" onClick={() => { setRecoveryMode(false); setFormError('') }} disabled={busy}>
            Return to Admin Login
          </button>
        </form>
        )) : (
        <form className="cms-login-form" onSubmit={submit} noValidate>
          {!localMode && <>
            <label htmlFor="admin-username">Email address</label>
            <div className="cms-login-input-wrap">
              <UserRound size={17} aria-hidden="true" />
              <input id="admin-username" type="email" autoComplete="username" inputMode="email" placeholder="Administrator email" value={username} onChange={(event) => setUsername(event.target.value)} disabled={!configured || busy} required />
            </div>
            <label htmlFor="admin-password">Password</label>
            <div className="cms-login-input-wrap">
              <LockKeyhole size={17} aria-hidden="true" />
              <input id="admin-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={!configured || busy} required />
              <button type="button" className="cms-password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={!password || busy}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <button type="button" className="cms-text-link cms-forgot-link" onClick={() => { setRecoveryMode(true); setFormError(''); clearError() }} disabled={!configured || busy}>
              Forgot Password?
            </button>
          </>}
          {localMode && recoveryAvailable && <button type="button" className="cms-text-link cms-forgot-link" onClick={() => { setRecoveryMode(true); setFormError(''); clearError() }} disabled={busy}>
            Forgot Password?
          </button>}
          {message && <p className="cms-login-error" role="alert">{message}</p>}
          <button className="cms-login-submit" type="submit" disabled={!configured || busy}>
            {busy ? (localMode ? 'Opening local CMS…' : 'Signing in…') : localMode ? 'Open local CMS' : 'Login'}
          </button>
        </form>
        )}
        {!recoveryMode && <p className="cms-login-footnote">{localMode ? 'Development-only access. The local CMS is not exposed as a production login.' : 'Use the email address configured for your Supabase administrator account.'}</p>}
      </section>
    </main>
  )
}
