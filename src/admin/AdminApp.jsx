import { useEffect, useState } from 'react'
import {
  ArrowUpRight, Bell, BriefcaseBusiness, FileText, FolderKanban,
  LayoutDashboard, Library, Menu, Search, Settings, UserRound,
} from 'lucide-react'
import { profile } from '../data/profile.js'
import { getPublicSiteUrl } from '../lib/siteUrls.js'
import { checkCmsApiHealth, useCmsApiStatus } from '../lib/adminApi.js'
import { AdminAuthProvider, useAdminAuth } from '../lib/adminAuth.jsx'
import { cmsHref, cmsRoutePath } from './cmsPaths.js'
import AdminLogin, { adminHomePath, adminLoginPath, safeAdminReturnPath } from './AdminLogin.jsx'
import BrandLink from '../components/common/BrandLink.jsx'
import {
  CmsBackgroundPage, CmsDashboardPage, CmsMediaPage, CmsProjectEditorPage,
  CmsProjectsPage, CmsResumePage, CmsSettingsPage,
} from './CmsPages.jsx'

const navigation = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Background', href: '/background', icon: BriefcaseBusiness },
  { label: 'Projects', href: '/projects', icon: FolderKanban },
  { label: 'Resume', href: '/resume', icon: FileText },
  { label: 'Media Library', href: '/media', icon: Library },
  { label: 'Settings', href: '/settings', icon: Settings },
]

function readPath() { return cmsRoutePath() }
function resolvedPublicUrl() {
  try { return { url: getPublicSiteUrl(), error: '' } }
  catch (error) { return { url: '', error: error instanceof Error ? error.message : 'Public URL unavailable.' } }
}

function Brand() {
  return <BrandLink className="cms-brand" href={cmsHref('/')} ariaLabel="Fitsum admin dashboard" logoSize={34} />
}

function AdminSidebar({ activePath, open, onClose }) {
  const { url, error } = resolvedPublicUrl()
  return <>{open && <button className="cms-sidebar-scrim" type="button" onClick={onClose} aria-label="Close navigation menu" />}<aside className={`cms-sidebar${open ? ' is-open' : ''}`}><Brand /><div className="cms-nav-label">CONTENT CORE</div><nav className="cms-nav" aria-label="Admin navigation">{navigation.map(({ label, href, icon: Icon }) => {
    const active = href === '/' ? activePath === '/' : activePath === href || activePath.startsWith(`${href}/`)
    return <a key={href} className={`cms-nav-link${active ? ' is-active' : ''}`} href={cmsHref(href)} aria-current={active ? 'page' : undefined} onClick={onClose}><Icon size={17} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span></a>
  })}</nav><div className="cms-sidebar-bottom">{url ? <a className="cms-public-link" href={url} target="_blank" rel="noreferrer">View Public Portfolio <ArrowUpRight size={15} /></a> : <p className="cms-public-link cms-public-link-error" title={error}>Public website URL not configured</p>}<div className="cms-user-card"><span className="cms-avatar" aria-hidden="true">FM</span><span className="cms-user-details"><strong>{profile.name}</strong><small>Portfolio curator</small></span></div></div></aside></>
}

function AdminHeader({ onToggleMenu, menuOpen, onLogout }) {
  const { url } = resolvedPublicUrl()
  const [search, setSearch] = useState('')
  const [logoutError, setLogoutError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const apiStatus = useCmsApiStatus()
  const submitSearch = (event) => {
    event.preventDefault()
    const value = search.trim()
    window.location.href = cmsHref(value ? `/projects?q=${encodeURIComponent(value)}` : '/projects')
  }
  const logout = async () => {
    setLoggingOut(true)
    setLogoutError('')
    try {
      await onLogout()
      window.location.replace(adminLoginPath())
    } catch {
      setLogoutError('Could not sign out. Please try again.')
      setLoggingOut(false)
    }
  }
  const degraded = !apiStatus.ready || apiStatus.storageReady === false
  return <header className="cms-topbar"><button className="cms-icon-button cms-menu-button" type="button" onClick={onToggleMenu} aria-label="Open navigation menu" aria-expanded={menuOpen}><Menu size={19} /></button><form className="cms-search" onSubmit={submitSearch}><Search size={17} /><input type="search" placeholder="Search projects…" aria-label="Search projects" value={search} onChange={(event) => setSearch(event.target.value)} /></form><button className={`cms-sync-pill${degraded ? ' is-muted' : ''}`} type="button" onClick={() => checkCmsApiHealth()} disabled={apiStatus.checking || apiStatus.state === 'unconfigured'} title={apiStatus.message} aria-label={`CMS status: ${apiStatus.message}`}><span className={`cms-status-dot${degraded ? ' is-muted' : ''}`} /><span>{apiStatus.checking ? 'Checking CMS API…' : apiStatus.label}</span></button><span className="cms-icon-button cms-notification-button" role="status" aria-label="No new notifications" title="No new notifications"><Bell size={18} /></span>{url ? <a className="cms-top-link" href={url} target="_blank" rel="noreferrer">View Website <ArrowUpRight size={15} /></a> : <span className="cms-top-link is-disabled">View Website</span>}<a className="cms-button cms-button-brown cms-publish-button" href={cmsHref('/projects?status=draft')}><span>{apiStatus.state === 'local' ? 'Review Local Drafts' : 'Review Project Drafts'}</span><ArrowUpRight size={14} /></a><button className="cms-logout-button" type="button" onClick={logout} disabled={loggingOut}>{loggingOut ? 'Signing out…' : 'Log out'}</button><span className="cms-avatar cms-top-avatar" aria-label={profile.name}><UserRound size={16} /></span>{logoutError && <span className="cms-logout-error" role="alert">{logoutError}</span>}</header>
}

function resolvePage(path) {
  if (path === '/') return <CmsDashboardPage />
  if (path === '/background') return <CmsBackgroundPage />
  if (path === '/projects') return <CmsProjectsPage />
  if (path === '/projects/new') return <CmsProjectEditorPage id="new" />
  const projectMatch = path.match(/^\/projects\/([^/]+)$/)
  if (projectMatch) return <CmsProjectEditorPage id={decodeURIComponent(projectMatch[1])} />
  if (path === '/resume') return <CmsResumePage />
  if (path === '/media') return <CmsMediaPage />
  if (path === '/settings') return <CmsSettingsPage />
  return <section className="cms-page-card"><p className="cms-eyebrow">PORTFOLIO CMS</p><h1>Page not found</h1><p className="cms-muted">That CMS page is not available.</p><a href={cmsHref('/')} className="cms-button cms-button-primary">Return to dashboard</a></section>
}

function AdminWorkspace({ onLogout }) {
  const [path, setPath] = useState(readPath)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    const sync = () => { setPath(readPath()); setMenuOpen(false) }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  useEffect(() => { checkCmsApiHealth() }, [])
  const apiStatus = useCmsApiStatus()
  const localMode = apiStatus.state === 'local'
  return <div className="cms-app"><AdminSidebar activePath={path} open={menuOpen} onClose={() => setMenuOpen(false)} /><div className="cms-main"><AdminHeader menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((value) => !value)} onLogout={onLogout} /><main className="cms-workspace">{localMode && <aside className="cms-local-mode-banner" role="status"><strong>Development mode · Local filesystem CMS</strong><span>JSON records and uploads stay on this machine. Publishing affects only this local portfolio preview.</span></aside>}{resolvePage(path)}<footer className="cms-footer-note">{localMode ? 'Local filesystem preview only · These records are not published to the live website.' : 'Firebase sign-in is active. Production content editing is unavailable until a persistent CMS provider is configured.'}</footer></main></div></div>
}

function AdminEntry() {
  const { loading, user, logout } = useAdminAuth()
  const loginRoute = cmsRoutePath() === '/login'
  const next = safeAdminReturnPath(new URLSearchParams(window.location.search).get('next'))
  useEffect(() => {
    if (loading) return
    if (!user && !loginRoute) {
      const current = `${window.location.pathname}${window.location.search}`
      const destination = adminLoginPath()
      const query = new URLSearchParams({ next: current })
      window.location.replace(`${destination}?${query}`)
      return
    }
    if (user && loginRoute) window.location.replace(next)
  }, [loading, user, loginRoute, next])

  if (loading || (!user && !loginRoute)) {
    return <main className="cms-auth-loading" role="status"><span className="cms-auth-spinner" />Verifying administrator access…</main>
  }
  if (loginRoute && !user) {
    return <AdminLogin onSuccess={() => window.location.replace(next || adminHomePath())} />
  }
  return user ? <AdminWorkspace onLogout={logout} /> : null
}

export default function AdminApp() {
  return <AdminAuthProvider><AdminEntry /></AdminAuthProvider>
}
