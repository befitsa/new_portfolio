import { useRef, useState } from 'react'
import { UserRound } from 'lucide-react'
import BrandLink from '../components/common/BrandLink.jsx'
import { useAdminAuth } from '../lib/adminAuth.jsx'
import { adminLoginPath } from './AdminLogin.jsx'

export default function AdminForgotPassword() {
  const { requestPasswordReset, clearError, recoveryAvailable } = useAdminAuth()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const submittingRef = useRef(false)

  const submit = async (event) => {
    event.preventDefault()
    if (submittingRef.current) return
    setError('')
    clearError()
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid administrator email address.')
      return
    }

    submittingRef.current = true
    setBusy(true)
    try {
      await requestPasswordReset(email)
      setSent(true)
    } catch {
      setError('We could not process that request right now. Please try again later.')
    } finally {
      submittingRef.current = false
      setBusy(false)
    }
  }

  return (
    <main className="cms-login-page" aria-labelledby="forgot-password-title">
      <section className="cms-login-card">
        <BrandLink className="cms-brand cms-login-brand" href="/" ariaLabel="Fitsum portfolio home" logoSize={44} />
        <p className="cms-eyebrow">SECURE ADMINISTRATION</p>
        <h1 id="forgot-password-title">Forgot your password?</h1>
        <p className="cms-login-intro">Enter your administrator email and we’ll send a secure password reset link if an account is eligible.</p>

        {sent ? (
          <div className="cms-recovery-status" role="status">
            <p>If an administrator account exists for that email, a password reset link will be sent shortly.</p>
            <a className="cms-text-link" href={adminLoginPath()}>Return to Admin Login</a>
          </div>
        ) : (
          <form className="cms-login-form" onSubmit={submit} noValidate>
            <label htmlFor="recovery-email">Email address</label>
            <div className="cms-login-input-wrap">
              <UserRound size={17} aria-hidden="true" />
              <input
                id="recovery-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="Administrator email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={!recoveryAvailable || busy}
                required
              />
            </div>
            {!recoveryAvailable && <p className="cms-login-error" role="alert">Password recovery is not available until Supabase Auth is configured.</p>}
            {error && <p className="cms-login-error" role="alert">{error}</p>}
            <button className="cms-login-submit" type="submit" disabled={!recoveryAvailable || busy}>
              {busy ? 'Sending reset link…' : 'Send reset link'}
            </button>
            <a className="cms-text-link" href={adminLoginPath()}>Return to Admin Login</a>
          </form>
        )}
      </section>
    </main>
  )
}
