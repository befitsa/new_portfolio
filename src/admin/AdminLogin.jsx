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
  const { login, error: authError, clearError, configured } = useAdminAuth()
  const localMode = isLocalFilesystemCms
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const message = formError || authError

  const submit = async (event) => {
    event.preventDefault()
    setFormError('')
    clearError()
    if (!localMode && (!username.trim() || !password)) {
      setFormError('Enter both your username and password.')
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

  return (
    <main className="cms-login-page" aria-labelledby="admin-login-title">
      <section className="cms-login-card">
        <BrandLink className="cms-brand cms-login-brand" href="/" ariaLabel="Fitsum portfolio home" logoSize={44} />
        <p className="cms-eyebrow">{localMode ? 'LOCAL DEVELOPMENT' : 'SECURE ADMINISTRATION'}</p>
        <h1 id="admin-login-title">Admin Login</h1>
        <p className="cms-login-intro">{localMode ? 'Local development CMS. No Firebase account or cloud service is used.' : 'Sign in with the administrator account to manage the portfolio.'}</p>

        <form className="cms-login-form" onSubmit={submit} noValidate>
          {!localMode && <>
            <label htmlFor="admin-username">Username</label>
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
          </>}
          {message && <p className="cms-login-error" role="alert">{message}</p>}
          <button className="cms-login-submit" type="submit" disabled={!configured || busy}>
            {busy ? (localMode ? 'Opening local CMS…' : 'Signing in…') : localMode ? 'Open local CMS' : 'Login'}
          </button>
        </form>
        <p className="cms-login-footnote">{localMode ? 'Development-only access. The local CMS is not exposed as a production login.' : 'Use your administrator Firebase email as the username.'}</p>
      </section>
    </main>
  )
}
