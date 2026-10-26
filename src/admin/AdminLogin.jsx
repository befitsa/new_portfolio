import { useState } from 'react'
import { Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react'
import { useAdminAuth } from '../lib/adminAuth.jsx'
import BrandLink from '../components/common/BrandLink.jsx'

export function adminLoginPath() { return /^\/admin(?:\/|$)/.test(window.location.pathname) ? '/admin/login' : '/login' }
export function adminHomePath() { return /^\/admin(?:\/|$)/.test(window.location.pathname) ? '/admin' : '/' }
export function safeAdminReturnPath(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return adminHomePath()
  if (/^\/(?:admin\/)?login(?:\/|$)/.test(value)) return adminHomePath()
  if (/^\/admin(?:\/|$)/.test(window.location.pathname) && !/^\/admin(?:\/|$)/.test(value)) return adminHomePath()
  return value
}

export default function AdminLogin({ onSuccess }) {
  const { login, error: authError, clearError, configured } = useAdminAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const message = formError || authError
  const submit = async (event) => {
    event.preventDefault()
    setFormError(''); clearError()
    if (!username.trim() || !password) { setFormError('Enter both your email and password.'); return }
    setBusy(true)
    try { await login(username, password); onSuccess() } catch {} finally { setBusy(false) }
  }
  const input = 'min-h-12 w-full rounded-lg border border-forest/15 bg-white px-3 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/10 disabled:opacity-60'
  return <main className="grid min-h-screen place-items-center bg-cream p-4 text-ink" aria-labelledby="admin-login-title">
    <section className="w-full max-w-[430px] rounded-2xl border border-forest/15 bg-paper p-7 shadow-[0_20px_55px_rgba(22,74,58,.09)] sm:p-10">
      <BrandLink className="mb-8" href="/" ariaLabel="Fitsum portfolio home" logoSize={42} />
      <p className="text-[10px] font-bold tracking-[.16em] text-gold">SECURE ADMINISTRATION</p>
      <h1 id="admin-login-title" className="mt-2 font-display text-3xl font-semibold text-forest">Admin Login</h1>
      <p className="mt-2 text-sm leading-6 text-forest/65">Sign in with the administrator account to manage portfolio content.</p>
      <form className="mt-6 grid gap-3" onSubmit={submit} noValidate>
        <label className="grid gap-1.5 text-sm font-semibold">Email<div className="relative"><UserRound className="absolute left-3 top-1/2 -translate-y-1/2 text-forest/50" size={17} /><input className={`${input} pl-10`} type="email" autoComplete="username" inputMode="email" placeholder="Administrator email" value={username} onChange={(event) => setUsername(event.target.value)} disabled={!configured || busy} required /></div></label>
        <label className="grid gap-1.5 text-sm font-semibold">Password<div className="relative"><LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 text-forest/50" size={17} /><input className={`${input} px-10`} type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={!configured || busy} required /><button type="button" className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-forest/60 hover:bg-forest/5" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={!password || busy}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        {message && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-5 text-red-800" role="alert">{message}</p>}
        <button className="mt-2 min-h-12 rounded-lg bg-forest px-4 text-sm font-bold text-white transition hover:bg-[#103b2e] disabled:cursor-wait disabled:opacity-60" type="submit" disabled={!configured || busy}>{busy ? 'Signing in…' : 'Login'}</button>
      </form>
      <p className="mt-5 text-center text-[11px] text-forest/60">Use the administrator Firebase email as the username.</p>
    </section>
  </main>
}
