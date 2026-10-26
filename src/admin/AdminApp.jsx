import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowUpRight, BriefcaseBusiness, Check, CircleUserRound, Clock3, ExternalLink, Eye, FileText, Filter, FolderKanban, GraduationCap, HardDrive, Image, LayoutDashboard, LogOut, Menu, Plus, Save, Search, Settings, ShieldCheck, SortAsc, Trash2, Upload, X } from 'lucide-react'
import { profile } from '../data/profile.js'
import { useAdminAuth, AdminAuthProvider } from '../lib/adminAuth.jsx'
import { adminApi, checkAdminApiHealth, uploadMedia, useAdminApiStatus } from '../lib/adminApi.js'
import AdminLogin, { adminHomePath, adminLoginPath, safeAdminReturnPath } from './AdminLogin.jsx'
import BrandLink from '../components/common/BrandLink.jsx'
import ProjectDetailsPage from '../components/projects/ProjectDetailsPage.jsx'
import { toPublicProject, toPublicExperience, toPublicEducation } from '../lib/db/presentation.js'
import { BackgroundTimeline } from '../components/sections/Background.jsx'
import { PortfolioProfileProvider } from '../context/PortfolioProfileContext.jsx'

const sections = ['Dashboard', 'Projects', 'Background & Credentials', 'Resume Management', 'Media Library', 'Portfolio Settings']
const contentTypes = ['projects', 'experiences', 'education', 'resumes']
const basePath = () => window.location.pathname.startsWith('/admin') ? '/admin' : ''
const routeFor = (path) => `${basePath()}${path === '/' ? '' : path}` || '/'
function publicPortfolioHref() {
  const configuredUrl = import.meta.env.VITE_PUBLIC_PORTFOLIO_URL?.trim()
  if (configuredUrl) return configuredUrl
  const configuredSubdomain = (import.meta.env.VITE_ADMIN_SUBDOMAIN || 'dev').trim().toLowerCase()
  const hostname = window.location.hostname.toLowerCase()
  if (configuredSubdomain && hostname.startsWith(`${configuredSubdomain}.`)) {
    const publicHost = hostname.slice(configuredSubdomain.length + 1)
    return `${window.location.protocol}//${publicHost}${window.location.port ? `:${window.location.port}` : ''}/`
  }
  return `${window.location.origin}/`
}
const readRoute = () => {
  const path = window.location.pathname.replace(/^\/admin/, '').replace(/\/+$/, '') || '/'
  if (path === '/background') return 'Background & Credentials'
  if (path.startsWith('/projects')) return 'Projects'
  if (path === '/resume') return 'Resume Management'
  if (path === '/media') return 'Media Library'
  if (path === '/settings') return 'Portfolio Settings'
  return 'Dashboard'
}
const blankProject = () => ({ title: '', slug: '', synopsis: '', executiveSummary: '', category: 'Web', role: '', timeline: '', readTime: 0, featured: false, visibility: true, order: Date.now(), thumbnailImage: { url: '', storagePath: '', mediaProvider: '', caption: '', order: 0 }, heroImage: { url: '', storagePath: '', mediaProvider: '', caption: '', order: 0 }, gallery: [], links: { github: '', figma: '', live: '' }, techStack: [], coreProblem: '', strategicObjectives: [], leadership: '', methodology: '', technicalHighlights: [], metrics: [], seo: {} })
const blankExperience = (order) => ({ role: '', company: '', logoInitials: '', startDate: new Date().toISOString().slice(0, 10), endDate: '', isCurrent: false, location: '', employmentType: '', description: '', responsibilities: [], achievements: [], logo: { url: '', storagePath: '', mediaProvider: '', caption: '', order: 0 }, image: { url: '', storagePath: '', mediaProvider: '', caption: '', order: 0 }, skills: [], visibility: true, order })
const blankEducation = (order) => ({ degree: '', institution: '', fieldOfStudy: '', image: { url: '', storagePath: '', mediaProvider: '', caption: '', order: 0 }, startYear: new Date().getFullYear(), endYear: null, notes: '', credentialUrl: '', visibility: true, order })
const blankResume = (order) => ({ title: '', description: '', fileUrl: '', previewUrl: '', storagePath: '', mediaProvider: '', fileName: '', sizeKB: 0, version: '1.0', notes: '', isActive: true, visibility: true, order })
const fallbackSettings = () => ({ name: profile.name, title: profile.title, bio: profile.intro, about: profile.about, location: '', socialLinks: Object.fromEntries(profile.socials.map(({ id, url }) => [id, url])), featuredProjectIds: [], seo: { metaTitle: '', metaDescription: '' } })

function AdminShell({ children, active, onLogout, onNavigate, projectSearch, onProjectSearchChange }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const status = useAdminApiStatus()
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const icons = [LayoutDashboard, FolderKanban, BriefcaseBusiness, FileText, Image, Settings]
  const route = (label) => ({ Dashboard: '/', Projects: '/projects', 'Background & Credentials': '/background', 'Resume Management': '/resume', 'Media Library': '/media', 'Portfolio Settings': '/settings' })[label]
  const statusLabel = status.checking ? 'Checking connection' : status.ready ? 'Services connected' : status.state === 'unconfigured' ? 'Setup needed' : 'Connection unavailable'
  const logout = async () => {
    try { await onLogout(); window.location.replace(adminLoginPath()) } catch { setLogoutError('Sign out failed. Try again.') }
  }
  const navigate = (path) => {
    onNavigate(path)
    setMenuOpen(false)
  }
  return <div className="min-h-screen bg-[#f5f1e8] text-[#22352d] md:grid md:grid-cols-[214px_minmax(0,1fr)]">
    {menuOpen && <button className="fixed inset-0 z-40 bg-black/30 md:hidden" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside className={`fixed inset-y-0 left-0 z-50 flex w-[270px] flex-col border-r border-[#d8cfbc] bg-[#eee8d9] px-3.5 py-4 transition-transform md:sticky md:top-0 md:h-screen md:w-auto md:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex min-h-10 items-center px-2">
        <BrandLink href={routeFor('/')} ariaLabel="Fitsum portfolio dashboard" logoSize={28} className="gap-2" />
      </div>
      <p className="mt-7 px-2 text-[9px] font-bold tracking-[.16em] text-[#817967]">CONTENT CORE</p>
      <nav className="mt-3 grid gap-1" aria-label="Admin navigation">
        {sections.map((label, index) => { const Icon = icons[index]; const selected = active === label
          return <a key={label} href={routeFor(route(label))} aria-current={selected ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate(route(label)) }} className={`flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-[12px] font-semibold transition-colors ${selected ? 'bg-[#dfe9dc] text-[#254c3e]' : 'text-[#5e6257] hover:bg-white/60 hover:text-[#254c3e]'}`}><Icon size={15} strokeWidth={1.9} />{label}</a>
        })}
      </nav>
      <div className="mt-auto grid gap-3 border-t border-[#d8cfbc] pt-3">
        <a href={publicPortfolioHref()} target="_blank" rel="noreferrer" className="flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-[12px] font-semibold text-[#5e6257] transition hover:bg-white/60 hover:text-[#254c3e]"><ExternalLink size={15} />View Website</a>
        <div className="rounded-lg border border-white/70 bg-[#f9f6ef] p-2.5">
          <p className="flex items-center gap-2 text-[10px] leading-4 text-[#666b60]" role="status">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${status.ready ? 'bg-emerald-600' : status.checking ? 'bg-amber-400' : 'bg-[#b77f4d]'}`} aria-hidden="true" />
            {statusLabel}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-white/70 bg-[#f9f6ef] p-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#dce8dc] text-[10px] font-bold text-[#315c4c]">FM</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[10px] font-bold tracking-wide text-[#3c473f]">FITSUM MESFIN</span>
            <span className="block text-[9px] text-[#77796f]">Portfolio admin</span>
          </span>
          <button onClick={logout} className="grid size-7 place-items-center rounded-md text-[#666b60] hover:bg-white" aria-label="Log out" title="Log out"><LogOut size={14} /></button>
        </div>
        {logoutError && <p className="text-xs text-red-700" role="alert">{logoutError}</p>}
      </div>
    </aside>
    <div className="min-w-0">
      <header className="sticky top-0 z-30 flex min-h-[54px] items-center gap-3 border-b border-[#e4dfd4] bg-[#fffefa]/95 px-4 backdrop-blur sm:px-6 lg:px-8">
        <button className="grid size-9 shrink-0 place-items-center rounded-lg border border-[#e5dfd2] md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={18} /></button>
        <form className="relative hidden max-w-[335px] flex-1 md:block" onSubmit={(event) => { event.preventDefault(); onNavigate(projectSearch ? `/projects?search=${encodeURIComponent(projectSearch)}` : '/projects') }}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8e84]" size={15} />
          <input className="h-9 w-full rounded-lg border border-[#e7e2d9] bg-white pl-9 pr-3 text-[11px] outline-none transition focus:border-[#a7b8a8] focus:ring-2 focus:ring-[#dfe9dc]" type="search" placeholder="Search projects…" aria-label="Search projects" value={projectSearch} onChange={(event) => onProjectSearchChange(event.target.value)} />
        </form>
        <button className="grid size-9 shrink-0 place-items-center rounded-lg text-[#71776e] hover:bg-[#f3efe6] md:hidden" onClick={() => setMobileSearchOpen((open) => !open)} aria-label={mobileSearchOpen ? 'Close project search' : 'Search projects'}><Search size={17} /></button>
        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 rounded-full border border-[#e4e7dc] bg-[#f0f3ed] px-3 py-2 text-[10px] font-medium text-[#687267] lg:flex">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${status.ready ? 'bg-emerald-600' : status.checking ? 'bg-amber-400' : 'bg-[#b77f4d]'}`} aria-hidden="true" />
            {statusLabel}
          </div>
          <a href={publicPortfolioHref()} target="_blank" rel="noreferrer" className="hidden text-[10px] font-medium text-[#888a80] hover:text-[#345b4b] sm:inline">View Website</a>
          <button type="button" onClick={() => onNavigate('/projects?filter=drafts')} className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#705039] px-3 text-[10px] font-bold text-white transition hover:bg-[#5d422f] sm:px-3.5">Review Project Drafts <ArrowUpRight size={12} /></button>
          <button type="button" onClick={logout} className="hidden min-h-8 items-center rounded-lg border border-[#e5d9ca] bg-[#f5eee5] px-3 text-[10px] font-semibold text-[#735e4b] hover:bg-[#eee3d5] sm:inline-flex">Log out</button>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#164a3a] text-white" title={profile.name}><CircleUserRound size={18} /></span>
        </div>
      </header>
      {mobileSearchOpen && <form className="relative border-b border-[#e4dfd4] bg-[#fffefa] px-4 py-2 md:hidden" onSubmit={(event) => { event.preventDefault(); onNavigate(projectSearch ? `/projects?search=${encodeURIComponent(projectSearch)}` : '/projects'); setMobileSearchOpen(false) }}><Search className="absolute left-7 top-1/2 -translate-y-1/2 text-[#8b8e84]" size={15} /><input autoFocus className="h-10 w-full rounded-lg border border-[#e7e2d9] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#a7b8a8]" type="search" placeholder="Search projects…" aria-label="Search projects" value={projectSearch} onChange={(event) => onProjectSearchChange(event.target.value)} /></form>}
      <main className="mx-auto w-full max-w-[1600px] p-5 sm:p-7 lg:px-8 lg:py-7">{children}</main>
    </div>
  </div>
}

function PageTitle({ eyebrow = 'PORTFOLIO ADMIN', title, description, action }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="flex items-center gap-1.5 text-[9px] font-bold tracking-[.13em] text-[#77715e]"><span className="inline-block size-1.5 rounded-full bg-[#31835f]" />{eyebrow}</p><h1 className="mt-1.5 font-serif text-[30px] font-semibold leading-[1.05] tracking-[-.035em] text-[#172d25] sm:text-[36px]">{title}</h1>{description && <p className="mt-2 max-w-3xl text-[11px] leading-5 text-[#73766e]">{description}</p>}</div>{action}</div>
}
function Notice({ message, error }) { return message ? <p className={`mb-5 rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`} role={error ? 'alert' : 'status'}>{message}</p> : null }
function Button({ children, kind = 'light', disabled, onClick, type = 'button', className = '', ...props }) {
  const styles = { primary: 'bg-forest text-white hover:bg-[#0f3c2d]', light: 'border border-forest/15 bg-white text-forest hover:bg-forest/5', publish: 'bg-[#dce8db] text-forest hover:bg-[#cfe0ce]', danger: 'border border-red-200 bg-red-50 text-red-800 hover:bg-red-100' }
  return <button {...props} type={type} onClick={onClick} disabled={disabled} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-50 ${styles[kind]} ${className}`}>{children}</button>
}
function Field({ label, children, hint, className = '' }) { return <label className={`grid gap-1.5 text-sm font-semibold text-forest/85 ${className}`}><span>{label}</span>{children}{hint && <small className="text-xs font-normal leading-5 text-forest/55">{hint}</small>}</label> }
function Input({ ...props }) { return <input {...props} className={`min-h-11 w-full rounded-lg border border-forest/15 bg-white px-3 text-sm font-normal outline-none focus:border-forest/60 focus:ring-2 focus:ring-forest/10 ${props.className || ''}`} /> }
function Textarea({ ...props }) { return <textarea {...props} className={`min-h-28 w-full rounded-lg border border-forest/15 bg-white px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-forest/60 focus:ring-2 focus:ring-forest/10 ${props.className || ''}`} /> }
const lines = (value) => String(value || '').split('\n').map((v) => v.trim()).filter(Boolean)
const csv = (value) => String(value || '').split(',').map((v) => v.trim()).filter(Boolean)
const lineValue = (value) => (value || []).join('\n')
const csvValue = (value) => (value || []).join(', ')
function badge(record) {
  if (record.status === 'published' && record.revision > record.publishedRevision) return 'Published · draft changes'
  if (record.status === 'published') return 'Published'
  return record.status === 'unpublished' ? 'Unpublished' : 'Draft'
}
function badgeStyle(record) { return record.status === 'published' ? 'bg-emerald-100 text-emerald-900' : record.status === 'unpublished' ? 'bg-stone-200 text-stone-700' : 'bg-amber-100 text-amber-900' }

function connectionState(status, loading, loadError) {
  if (status.checking || loading) return { value: 'Checking', tone: 'amber' }
  if (!status.ready || loadError) return { value: status.state === 'unconfigured' ? 'Not configured' : 'Unavailable', tone: 'brown' }
  return { value: 'Available', tone: 'green' }
}

function DashboardPage({ data, loading, error, status, onCreateProject, onCreateExperience, onCreateEducation, onCreateResume, onNavigate }) {
  const total = (type) => data[type]?.length || 0
  const published = (type) => data[type]?.filter((record) => record.status === 'published').length || 0
  const drafts = (type) => Math.max(0, total(type) - published(type))
  const currentResume = (data.resumes || []).find((record) => record.status === 'published' && record.publishedData?.isActive)
  const projectItems = (data.projects || []).filter((record) => record.draftData?.featured).slice(0, 4)
  const recentActivity = [...(data.projects || []), ...(data.experiences || []), ...(data.education || []), ...(data.resumes || [])]
    .filter((record) => record.updatedAt || record.createdAt || record.publishedAt)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || b.publishedAt || 0) - new Date(a.updatedAt || a.createdAt || a.publishedAt || 0))
    .slice(0, 4)
  const mediaCount = collectMedia(data).length
  const dataState = connectionState(status, loading, error)
  const storageState = connectionState(status, loading, error)
  const websiteState = { value: 'URL available', tone: 'green' }
  const statusItems = [
    { label: 'Website', detail: websiteState.value, icon: ExternalLink, state: websiteState },
    { label: 'Portfolio data', detail: dataState.value, icon: FolderKanban, state: dataState },
    { label: 'File storage', detail: storageState.value, icon: HardDrive, state: storageState },
  ]

  return <>
    <PageTitle eyebrow="PORTFOLIO ADMIN" title="Welcome back, Fitsum" description="Manage your projects, professional background, and portfolio documents in one place." />
    {loading ? <div className="rounded-xl border border-[#e8e2d7] bg-[#fffefa] p-6 text-sm text-[#6c7168]" role="status">Loading portfolio content…</div> : <>
      {error && <Notice message={status.message ? `Portfolio data could not be loaded. ${status.message}` : 'Portfolio data could not be loaded. Check the connection status below, then try again.'} error />}
      <section className="mb-5 rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-4 shadow-[0_2px_8px_rgba(52,45,32,.04)] sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold tracking-[.14em] text-[#77715e]">PORTFOLIO STATUS</p>
            <h2 className="mt-1 font-serif text-xl font-semibold leading-tight text-[#1b3028]">Your portfolio workspace</h2>
          </div>
          {!status.ready && <button onClick={() => onNavigate('/settings')} className="min-h-8 rounded-lg border border-[#e3d6c7] bg-[#f8f1e7] px-3 text-[10px] font-semibold text-[#745c46] transition hover:bg-[#f1e6d8]">Portfolio Settings</button>}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {statusItems.map(({ label, detail, icon: Icon, state }) => (
            <div key={label} className="flex items-center gap-2.5 rounded-lg border border-[#eee8dd] bg-[#fbf9f4] px-3 py-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[#edf3ed] text-[#476a58]"><Icon size={15} /></span>
              <span className="min-w-0 flex-1"><span className="block text-[9px] font-semibold text-[#77786f]">{label}</span><span className="block text-[11px] font-semibold text-[#34473d]">{detail}</span></span>
              <span className={`size-1.5 shrink-0 rounded-full ${state.tone === 'green' ? 'bg-emerald-600' : state.tone === 'amber' ? 'bg-amber-500' : 'bg-[#b77f4d]'}`} aria-hidden="true" />
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[
        ['Total Projects', error ? '—' : total('projects'), error ? 'Portfolio data unavailable' : `${published('projects')} published · ${drafts('projects')} drafts`, FolderKanban],
        ['Published Projects', error ? '—' : published('projects'), error ? 'Portfolio data unavailable' : `${total('projects')} total project records`, ShieldCheck],
        ['Work Experience', error ? '—' : total('experiences'), error ? 'Portfolio data unavailable' : `${published('experiences')} published · ${drafts('experiences')} drafts`, BriefcaseBusiness],
        ['Education & Degrees', error ? '—' : total('education'), error ? 'Portfolio data unavailable' : `${published('education')} published · ${drafts('education')} drafts`, GraduationCap],
        ['Resume Status', error ? 'Unavailable' : currentResume ? 'Active' : 'Not configured', error ? 'Portfolio data unavailable' : currentResume?.publishedData?.fileName || 'No published resume', FileText],
        ['Media Files', error ? '—' : mediaCount, error ? 'Portfolio data unavailable' : 'Uploaded assets attached to portfolio records', Image],
      ].map(([label, count, detail, Icon]) => <article key={label} className="rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-4 shadow-[0_2px_8px_rgba(52,45,32,.04)] transition hover:-translate-y-0.5 hover:shadow-[0_5px_14px_rgba(52,45,32,.07)]">
        <div className="flex items-center justify-between"><p className="text-[9px] font-bold tracking-[.08em] text-[#64695f]">{label.toUpperCase()}</p><span className="grid size-8 place-items-center rounded-md bg-[#edf3ed] text-[#476a58]"><Icon size={15} /></span></div>
        <p className="mt-2 font-serif text-[27px] font-semibold leading-none text-[#172d25]">{count}</p><p className="mt-2 truncate text-[10px] text-[#77796f]">{detail}</p>
      </article>)}</div>

      <section className="mt-5 grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
        <div className="rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-4 shadow-[0_2px_8px_rgba(52,45,32,.04)] sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[9px] font-bold tracking-[.12em] text-[#77715e]">QUICK ACTIONS</p><h2 className="mt-1 font-serif text-xl font-semibold text-[#1b3028]">What would you like to update?</h2></div></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              ['Add Project', 'Create a case study', onCreateProject, FolderKanban],
              ['Add Experience', 'Update your work history', onCreateExperience, BriefcaseBusiness],
              ['Add Education', 'Add a qualification', onCreateEducation, GraduationCap],
              ['Upload Resume', 'Add a PDF version', onCreateResume, FileText],
            ].map(([label, detail, onClick, Icon]) => <button key={label} onClick={onClick} className="group flex min-h-[68px] items-center gap-3 rounded-lg border border-[#e9e3d8] bg-[#fbf9f4] px-3 text-left transition hover:border-[#c9a14a]/50 hover:bg-[#f7f2e8]">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-white text-[#476a58] shadow-sm"><Icon size={16} /></span>
              <span className="min-w-0 flex-1"><span className="block text-[11px] font-bold text-[#34473d]">{label}</span><span className="mt-0.5 block text-[9px] text-[#77796f]">{detail}</span></span><Plus className="text-[#8f927f] transition group-hover:text-[#705039]" size={15} />
            </button>)}
          </div>
        </div>

        <div className="rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-4 shadow-[0_2px_8px_rgba(52,45,32,.04)] sm:p-5">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-bold tracking-[.12em] text-[#77715e]">LIVE SITE</p><h2 className="mt-1 font-serif text-xl font-semibold text-[#1b3028]">Website preview</h2></div><a href={publicPortfolioHref()} target="_blank" rel="noreferrer" aria-label="Open public portfolio" className="grid size-8 place-items-center rounded-md border border-[#e9e3d8] text-[#66766a] hover:bg-[#f2f5ef]"><ExternalLink size={14} /></a></div>
          <div className="mt-4 overflow-hidden rounded-lg border border-[#e9e3d8] bg-[#f1f4ef]">
            <div className="flex items-center gap-1.5 border-b border-[#e4e8e0] bg-[#fffefa] px-3 py-2"><span className="size-1.5 rounded-full bg-[#d5a27b]" /><span className="size-1.5 rounded-full bg-[#d7c68f]" /><span className="size-1.5 rounded-full bg-[#91b99c]" />            <span className="ml-auto truncate text-[8px] text-[#898b82]">{new URL(publicPortfolioHref(), window.location.origin).host}</span></div>
            <div className="p-4 sm:p-5"><span className="grid size-7 place-items-center rounded-full bg-[#164a3a] text-[9px] font-bold text-white">FM</span><p className="mt-3 font-serif text-lg font-semibold text-[#17342a]">FITSUM MESFIN</p><p className="mt-1 text-[9px] text-[#73786e]">Software Developer · React Developer · Flutter Developer</p></div>
          </div>
          <a href={publicPortfolioHref()} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-md bg-[#705039] px-3 text-[10px] font-semibold text-white transition hover:bg-[#5d422f]">View Live Website <ArrowUpRight size={12} /></a>
        </div>
      </section>

      <section className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-4 shadow-[0_2px_8px_rgba(52,45,32,.04)] sm:p-5">
          <div className="flex items-center justify-between gap-3"><div><h2 className="font-serif text-xl font-semibold text-[#1b3028]">Recent activity</h2><p className="mt-1 text-[10px] text-[#77796f]">Latest changes to your portfolio content.</p></div><Clock3 className="text-[#829285]" size={16} /></div>
          {error ? <div className="mt-4 rounded-lg border border-dashed border-[#ded8cc] bg-[#fbf9f4] p-7 text-center text-[11px] text-[#77796f]">Recent activity is unavailable until portfolio data can be loaded.</div> : recentActivity.length === 0 ? <div className="mt-4 rounded-lg border border-dashed border-[#ded8cc] bg-[#fbf9f4] p-7 text-center text-[11px] text-[#77796f]">No recent activity yet. Your saved projects, credentials, and resume updates will appear here.</div> : <div className="mt-3 divide-y divide-[#eee9df]">{recentActivity.map((record) => {
            const title = record.draftData?.title || record.draftData?.role || record.draftData?.degree || record.draftData?.fileName || 'Untitled'
            const kind = record.type === 'projects' ? 'Project' : record.type === 'experiences' ? 'Experience' : record.type === 'education' ? 'Education' : 'Resume'
            return <div key={`${record.type}-${record.id}`} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><p className="truncate text-[11px] font-semibold text-[#34473d]">{title}</p><p className="text-[9px] text-[#85877d]">{kind} · {record.status === 'published' ? 'Published' : record.status === 'unpublished' ? 'Unpublished' : 'Draft'}</p></div><time className="shrink-0 text-[9px] text-[#888a80]">{new Date(record.updatedAt || record.createdAt || record.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></div>
          })}</div>}
        </div>
        <div className="rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-4 shadow-[0_2px_8px_rgba(52,45,32,.04)] sm:p-5">
          <div className="flex items-center justify-between gap-3"><div><h2 className="font-serif text-xl font-semibold text-[#1b3028]">Featured projects</h2><p className="mt-1 text-[10px] text-[#77796f]">A quick look at your recent work.</p></div><button onClick={() => onNavigate('/projects')} className="text-[9px] font-semibold text-[#6d5844] hover:underline">View all</button></div>
          {error ? <div className="mt-4 rounded-lg border border-dashed border-[#ded8cc] bg-[#fbf9f4] p-7 text-center text-[11px] text-[#77796f]">Featured projects are unavailable until portfolio data can be loaded.</div> : projectItems.length === 0 ? <div className="mt-4 rounded-lg border border-dashed border-[#ded8cc] bg-[#fbf9f4] p-7 text-center text-[11px] text-[#77796f]">No featured projects yet. Feature a case study to highlight it here.</div> : <div className="mt-3 space-y-2">{projectItems.map((project) => {
            const draft = project.draftData || {}
            return <button key={project.id} onClick={() => onNavigate('/projects')} className="flex w-full items-center gap-3 rounded-lg border border-[#eee9df] bg-[#fbf9f4] p-2 text-left transition hover:bg-[#f5f2e9]">
              <div className="h-12 w-16 shrink-0 overflow-hidden rounded-md bg-[#e9eee8]">{draft.thumbnailImage?.url ? <img src={draft.thumbnailImage.url} alt={draft.thumbnailImage.caption || draft.title || 'Project cover'} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><FolderKanban size={15} className="text-[#7f9383]" /></div>}</div>
              <span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-semibold text-[#34473d]">{draft.title || 'Untitled project'}</span><span className="mt-0.5 block text-[9px] text-[#85877d]">{draft.category || 'Portfolio project'}</span></span><span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${badgeStyle(project)}`}>{badge(project)}</span>
            </button>
          })}</div>}
        </div>
      </section>
    </>}
  </>
}

function collectMedia(data) {
  const assets = new Map()
  for (const type of ['projects', 'experiences', 'education', 'resumes']) {
    for (const record of data[type] || []) {
      for (const [version, content] of [['published', record.publishedData], ['draft', record.draftData]]) {
        const visit = (value, path = '') => {
          if (Array.isArray(value)) {
            value.forEach((item, index) => visit(item, `${path}.${index}`))
            return
          }
          if (!value || typeof value !== 'object') return
          const isResumeFile = type === 'resumes' && Boolean(value.fileUrl || value.previewUrl || value.storagePath)
          const isImage = type !== 'resumes' && Boolean(value.storagePath || value.url) && (value.mediaProvider === 'cloudinary' || /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(value.url || '') || path.includes('Image') || path.includes('gallery') || path.endsWith('.logo'))
          if (isResumeFile || isImage) {
            const src = isResumeFile ? value.previewUrl || value.fileUrl : value.url
            const key = value.storagePath || src
            if (key && src) {
              const asset = {
                id: key,
                src,
                fileName: value.fileName || value.caption || (isResumeFile ? 'Resume PDF' : 'Portfolio image'),
                format: isResumeFile ? 'PDF' : String(value.format || src.split('.').pop().split(/[?#]/)[0] || 'IMAGE').toUpperCase(),
                type,
                record,
                version: version === 'published' && record.status === 'published' ? 'published' : 'draft',
                isResumeFile,
                title: record.draftData?.title || record.draftData?.role || record.draftData?.degree || record.draftData?.fileName || 'Untitled',
              }
              if (!assets.has(key) || (version === 'published' && record.status === 'published')) assets.set(key, asset)
            }
          }
          for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key)
        }
        visit(content)
      }
    }
  }
  return [...assets.values()]
}

function SummaryCard({ label, value, detail, icon: Icon }) {
  return <article className="rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-4 shadow-[0_2px_8px_rgba(52,45,32,.04)]">
    <div className="flex items-center justify-between gap-3"><p className="text-[9px] font-bold tracking-[.08em] text-[#64695f]">{label.toUpperCase()}</p><span className="grid size-8 place-items-center rounded-md bg-[#edf3ed] text-[#476a58]"><Icon size={15} /></span></div>
    <p className="mt-2 font-serif text-[25px] font-semibold leading-none text-[#172d25]">{value}</p>
    {detail && <p className="mt-2 truncate text-[10px] text-[#77796f]">{detail}</p>}
  </article>
}

function ProjectManagement({ records, loading, error, onCreate, onEdit, onAction, onReorder, globalSearch, locationKey }) {
  const [search, setSearch] = useState(() => globalSearch || new URLSearchParams(window.location.search).get('search') || '')
  const initialFilter = new URLSearchParams(window.location.search).get('filter')
  const [filter, setFilter] = useState(initialFilter === 'drafts' ? 'Drafts' : 'All Projects')
  const [category, setCategory] = useState('All categories')
  const [sort, setSort] = useState('Display order')
  useEffect(() => { setSearch(globalSearch) }, [globalSearch])
  useEffect(() => {
    const params = new URLSearchParams(locationKey)
    setSearch(params.get('search') || '')
    setFilter(params.get('filter') === 'drafts' ? 'Drafts' : 'All Projects')
  }, [locationKey])
  const publishedCount = records.filter((record) => record.status === 'published').length
  const draftCount = records.length - publishedCount
  const featuredCount = records.filter((record) => record.draftData?.featured).length
  const tabs = [
    ['All Projects', records.length],
    ['Published', publishedCount],
    ['Drafts', draftCount],
    ['Featured', featuredCount],
  ]
  const categories = ['All categories', ...new Set(records.map((record) => record.draftData?.category).filter(Boolean))]
  const shown = useMemo(() => {
    let result = records.filter((record) => {
      const content = record.draftData || {}
      const terms = [content.title, content.synopsis, content.slug, content.category, ...(content.techStack || [])].join(' ').toLowerCase()
      const matchesSearch = terms.includes(search.trim().toLowerCase())
      const matchesFilter = filter === 'All Projects' || (filter === 'Published' && record.status === 'published') || (filter === 'Drafts' && record.status !== 'published') || (filter === 'Featured' && content.featured)
      return matchesSearch && matchesFilter && (category === 'All categories' || content.category === category)
    })
    if (sort === 'Title') result = [...result].sort((a, b) => (a.draftData?.title || '').localeCompare(b.draftData?.title || ''))
    if (sort === 'Recently updated') result = [...result].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    return result
  }, [records, search, filter, category, sort])

  return <>
    <PageTitle eyebrow="PORTFOLIO PROJECTS" title="Projects & Case Studies" description="Create, edit, preview, and publish projects to your public portfolio." action={<Button kind="primary" onClick={onCreate}><Plus size={15} />Create New Project</Button>} />
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label="All Projects" value={error ? '—' : records.length} detail={error ? 'Portfolio data unavailable' : 'Portfolio case studies'} icon={FolderKanban} />
      <SummaryCard label="Published" value={error ? '—' : publishedCount} detail={error ? 'Portfolio data unavailable' : 'Visible on your website'} icon={ShieldCheck} />
      <SummaryCard label="Drafts" value={error ? '—' : draftCount} detail={error ? 'Portfolio data unavailable' : 'Private until published'} icon={FileText} />
      <SummaryCard label="Featured" value={error ? '—' : featuredCount} detail={error ? 'Portfolio data unavailable' : 'Highlighted projects'} icon={Image} />
    </div>
    <div className="mb-4 overflow-hidden rounded-xl border border-[#e9e3d8] bg-[#fffefa] shadow-[0_2px_8px_rgba(52,45,32,.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eee9df] px-3 py-2.5">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter projects by status">
          {tabs.map(([label, count]) => <button key={label} role="tab" aria-selected={filter === label} onClick={() => setFilter(label)} className={`inline-flex min-h-8 items-center gap-2 rounded-md px-2.5 text-[10px] font-semibold transition ${filter === label ? 'bg-[#e3edf3] text-[#365b70]' : 'text-[#626a62] hover:bg-[#f4f1e9]'}`}>{label}<span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[8px]">{error ? '—' : count}</span></button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[170px] flex-1 sm:min-w-[220px]"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#898d83]" size={13} /><Input className="h-8 min-h-8 rounded-md border-[#e7e2d9] pl-8 text-[10px]" type="search" placeholder="Search title, stack, slug…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search projects by title, technology, or slug" /></label>
          <label className="relative"><Filter className="absolute left-2 top-1/2 -translate-y-1/2 text-[#898d83]" size={12} /><select className="h-8 rounded-md border border-[#e7e2d9] bg-white pl-7 pr-2 text-[10px] text-[#596258]" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category">{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="relative"><SortAsc className="absolute left-2 top-1/2 -translate-y-1/2 text-[#898d83]" size={12} /><select className="h-8 rounded-md border border-[#e7e2d9] bg-white pl-7 pr-2 text-[10px] text-[#596258]" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort projects"><option>Display order</option><option>Recently updated</option><option>Title</option></select></label>
        </div>
      </div>
      {error && <div className="px-4 pt-3"><Notice error message={error} /></div>}
      {loading ? <p className="p-8 text-center text-[11px] text-[#74776f]" role="status">Loading projects…</p> : error ? <p className="p-8 text-center text-[11px] text-[#74776f]" role="status">Project records are unavailable until the portfolio service can be reached.</p> : shown.length === 0 ? <div className="p-9 text-center"><FolderKanban size={20} className="mx-auto text-[#758a7c]" /><h2 className="mt-3 font-serif text-xl font-semibold text-[#273b31]">{records.length ? 'No matching projects' : 'No projects yet'}</h2><p className="mt-1 text-[11px] text-[#77796f]">{records.length ? 'Try another search or filter.' : 'Create your first case study to begin building your portfolio.'}</p>{records.length === 0 && <Button className="mt-4" kind="primary" onClick={onCreate}><Plus size={14} />Create New Project</Button>}</div> : <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((record) => {
          const content = record.draftData || {}
          return <article key={record.id} className="overflow-hidden rounded-lg border border-[#e9e3d8] bg-[#fffefa] shadow-[0_2px_8px_rgba(52,45,32,.04)] transition hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(52,45,32,.08)]">
            <div className="relative aspect-[16/9] overflow-hidden bg-[#e9eee8]">
              {content.thumbnailImage?.url ? <img src={content.thumbnailImage.url} alt={content.thumbnailImage.caption || content.title || 'Project cover'} className="h-full w-full object-cover transition duration-300 hover:scale-[1.02]" /> : <div className="grid h-full place-items-center text-[#829487]"><FolderKanban size={24} /></div>}
              <span className={`absolute left-3 top-3 rounded-full px-2 py-1 text-[9px] font-bold ${badgeStyle(record)}`}>{badge(record)}</span>
              {content.featured && <span className="absolute right-3 top-3 rounded-full bg-[#fff8e6] px-2 py-1 text-[9px] font-semibold text-[#8b6c36]">Featured</span>}
            </div>
            <div className="p-3.5">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate font-serif text-lg font-semibold leading-tight text-[#1b3028]">{content.title || 'Untitled project'}</h2><p className="mt-1 text-[9px] text-[#77796f]">{content.category || 'Portfolio project'}{content.timeline ? ` · ${content.timeline}` : ''}</p></div><button onClick={() => onReorder(record, -1)} disabled={sort !== 'Display order' || records.indexOf(record) === 0} className="grid size-7 shrink-0 place-items-center rounded-md border border-[#e9e3d8] text-[#737b70] hover:bg-[#f4f1e9] disabled:opacity-30" aria-label={`Move ${content.title || 'project'} up`} title="Move up in display order">↑</button></div>
              <p className="mt-2 line-clamp-2 min-h-8 text-[10px] leading-4 text-[#73766e]">{content.synopsis || content.executiveSummary || 'Add a short project summary.'}</p>
              <div className="mt-2 flex min-h-5 flex-wrap gap-1">{(content.techStack || []).slice(0, 4).map((tech) => <span key={tech} className="rounded-full bg-[#f0f2ed] px-2 py-1 text-[8px] font-medium text-[#5c6b5f]">{tech}</span>)}</div>
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[#eee9df] pt-3">
                <Button className="min-h-8 rounded-md px-2.5 text-[9px]" onClick={() => onEdit(record, true)}><Eye size={12} />Preview</Button>
                <Button className="min-h-8 rounded-md px-2.5 text-[9px]" onClick={() => onEdit(record)}><Settings size={12} />Edit</Button>
                {record.status === 'published' ? <Button className="min-h-8 rounded-md px-2.5 text-[9px]" onClick={() => onAction('unpublish', record)}>Unpublish</Button> : <Button kind="publish" className="min-h-8 rounded-md px-2.5 text-[9px]" onClick={() => onAction('publish', record)}><Check size={12} />Publish</Button>}
                <Button kind="danger" className="ml-auto min-h-8 rounded-md px-2.5 text-[9px]" onClick={() => onAction('delete', record)} aria-label={`Delete ${content.title || 'project'}`}><Trash2 size={12} /></Button>
              </div>
            </div>
          </article>
        })}
      </div>}
    </div>
  </>
}

function BackgroundManager({ data, loading, error, onCreate, onEdit, onAction, onReorder }) {
  const [tab, setTab] = useState('Work Experience')
  const experiences = data.experiences || []
  const education = data.education || []
  const records = tab === 'Work Experience' ? experiences : education
  const published = [...experiences, ...education].filter((record) => record.status === 'published').length
  const drafts = experiences.length + education.length - published
  return <>
    <PageTitle eyebrow="CAREER & EDUCATION" title="Background & Credentials" description="Manage your professional experience, education, skills, and career timeline." action={<div className="flex flex-wrap gap-2"><Button kind="primary" onClick={() => onCreate('experiences')}><Plus size={14} />Add Experience</Button><Button onClick={() => onCreate('education')}><Plus size={14} />Add Education</Button></div>} />
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <SummaryCard label="Total Entries" value={error ? '—' : experiences.length + education.length} detail={error ? 'Portfolio data unavailable' : 'Career and education records'} icon={FolderKanban} />
      <SummaryCard label="Work Experience" value={error ? '—' : experiences.length} detail={error ? 'Portfolio data unavailable' : 'Professional roles'} icon={BriefcaseBusiness} />
      <SummaryCard label="Education & Degrees" value={error ? '—' : education.length} detail={error ? 'Portfolio data unavailable' : 'Qualifications and courses'} icon={GraduationCap} />
      <SummaryCard label="Published Entries" value={error ? '—' : published} detail={error ? 'Portfolio data unavailable' : `${drafts} private drafts`} icon={ShieldCheck} />
      <SummaryCard label="Draft Entries" value={error ? '—' : drafts} detail={error ? 'Portfolio data unavailable' : 'Private until published'} icon={FileText} />
    </div>
    <div className="mb-3 flex flex-wrap items-center gap-1 rounded-lg border border-[#e9e3d8] bg-[#fffefa] p-1.5" role="tablist" aria-label="Background sections">
      {[
        ['Work Experience', experiences.length, BriefcaseBusiness],
        ['Education & Degrees', education.length, GraduationCap],
      ].map(([label, count, Icon]) => <button key={label} role="tab" aria-selected={tab === label} onClick={() => setTab(label)} className={`inline-flex min-h-8 items-center gap-2 rounded-md px-3 text-[10px] font-semibold transition ${tab === label ? 'bg-[#e3edf3] text-[#365b70]' : 'text-[#626a62] hover:bg-[#f4f1e9]'}`}><Icon size={13} />{label}<span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[8px]">{error ? '—' : count}</span></button>)}
    </div>
    <ContentList type={tab === 'Work Experience' ? 'experiences' : 'education'} records={records} loading={loading} error={error} onCreate={() => onCreate(tab === 'Work Experience' ? 'experiences' : 'education')} onEdit={onEdit} onAction={onAction} onReorder={onReorder} />
  </>
}

function ContentList({ type, records = [], loading, error, onEdit, onCreate, onAction, onReorder }) {
  const shown = records
  const isExperience = type === 'experiences'
  const createLabel = isExperience ? 'Add Experience' : 'Add Education'
  return <>
    {error && <Notice error message={error} />}
    {loading ? <div className="rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-8 text-center text-[11px] text-[#74776f]" role="status">Loading portfolio content…</div> : error ? <div className="rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-8 text-center text-[11px] text-[#74776f]" role="status">These entries are unavailable until the portfolio service can be reached.</div> : shown.length === 0 ? <section className="rounded-xl border border-dashed border-[#ded8cc] bg-[#fffefa]/80 p-10 text-center"><span className="mx-auto grid size-10 place-items-center rounded-lg bg-[#edf3ed] text-[#476a58]">{isExperience ? <BriefcaseBusiness size={18} /> : <GraduationCap size={18} />}</span><h2 className="mt-3 font-serif text-xl font-semibold text-[#273b31]">No {isExperience ? 'work experience' : 'education'} entries yet</h2><p className="mt-1 text-[11px] text-[#77796f]">Add your history and publish each item when it is ready.</p><Button className="mt-4" kind="primary" onClick={onCreate}><Plus size={14} />{createLabel}</Button></section> : <div className="grid gap-3">{shown.map((record, index) => {
      const content = record.draftData || {}
      const title = content.role || content.degree || 'Untitled entry'
      const organization = content.company || content.institution || ''
      const dateRange = isExperience
        ? `${content.startDate || ''} – ${content.isCurrent ? 'Present' : content.endDate || '—'}`
        : `${content.startYear || ''} – ${content.endYear || 'Present'}`
      const description = content.description || content.notes || ''
      const tags = content.skills || (content.fieldOfStudy ? [content.fieldOfStudy] : [])
      return <article key={record.id} className="rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-4 shadow-[0_2px_8px_rgba(52,45,32,.04)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h2 className="font-serif text-lg font-semibold leading-tight text-[#1b3028]">{title}</h2><span className={`rounded-full px-2 py-1 text-[8px] font-bold ${badgeStyle(record)}`}>{badge(record)}</span></div>
            <p className="mt-1 text-[10px] font-semibold text-[#58685d]">{organization}{content.location ? ` · ${content.location}` : ''}{content.employmentType ? ` · ${content.employmentType}` : ''}</p>
            <p className="mt-1 text-[9px] text-[#81847b]">{dateRange}</p>
            {description && <p className="mt-3 max-w-3xl whitespace-pre-line text-[10px] leading-5 text-[#6f746c]">{description}</p>}
            {tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{tags.map((tag) => <span key={tag} className="rounded-full bg-[#f0f2ed] px-2 py-1 text-[8px] text-[#5c6b5f]">{tag}</span>)}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button className="min-h-8 rounded-md px-2.5 text-[9px]" onClick={() => onEdit(record, true)}><Eye size={12} />Preview</Button>
            <Button className="min-h-8 rounded-md px-2.5 text-[9px]" onClick={() => onEdit(record)}><Settings size={12} />Edit</Button>
            <Button className="min-h-8 rounded-md px-2 text-[9px]" onClick={() => onReorder(record, -1)} disabled={index === 0} aria-label="Move entry up">↑</Button>
            <Button className="min-h-8 rounded-md px-2 text-[9px]" onClick={() => onReorder(record, 1)} disabled={index === shown.length - 1} aria-label="Move entry down">↓</Button>
            {record.status === 'published' ? <Button className="min-h-8 rounded-md px-2.5 text-[9px]" onClick={() => onAction('unpublish', record)}>Unpublish</Button> : <Button kind="publish" className="min-h-8 rounded-md px-2.5 text-[9px]" onClick={() => onAction('publish', record)}><Check size={12} />Publish</Button>}
            <Button kind="danger" className="min-h-8 rounded-md px-2.5 text-[9px]" onClick={() => onAction('delete', record)} aria-label={`Delete ${title}`}><Trash2 size={12} /></Button>
          </div>
        </div>
      </article>
    })}</div>}
  </>
}

function MediaUpload({ kind = 'image', onComplete, disabled }) {
  const [progress, setProgress] = useState(-1)
  const [error, setError] = useState('')
  const upload = async (file) => {
    if (!file) return
    setProgress(0); setError('')
    try { const result = await uploadMedia(file, kind, setProgress); onComplete(result) }
    catch (cause) { setError(cause.message || 'Upload failed.') }
    finally { setProgress(-1) }
  }
  return <div className="flex flex-wrap items-center gap-3"><label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-forest/15 bg-white px-4 text-sm font-semibold hover:bg-forest/5"><Upload size={15} />{progress >= 0 ? `Uploading ${progress}%` : kind === 'resume' ? 'Upload PDF' : 'Upload image'}<input className="sr-only" type="file" accept={kind === 'resume' ? 'application/pdf,.pdf' : 'image/jpeg,image/png,image/webp'} disabled={disabled || progress >= 0} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = '' }} /></label>{progress >= 0 && <progress className="w-32 accent-forest" max="100" value={progress} aria-label="Upload progress" />}{error && <span className="text-xs text-red-700" role="alert">{error}</span>}</div>
}

function EditDialog({ type, record, onClose, onSaved, notify, initialPreview = false }) {
  const [saving, setSaving] = useState(false)
  const [content, setContent] = useState(() => structuredClone(record?.draftData || (type === 'projects' ? blankProject() : type === 'experiences' ? blankExperience(Date.now()) : type === 'education' ? blankEducation(Date.now()) : blankResume(Date.now()))))
  const [currentRecord, setCurrentRecord] = useState(record)
  const [preview, setPreview] = useState(initialPreview)
  const [error, setError] = useState('')
  const set = (key, value) => setContent((old) => ({ ...old, [key]: value }))
  const save = async () => {
    setSaving(true); setError('')
    try {
      const next = currentRecord ? await adminApi.save(type, currentRecord.id, content, currentRecord.revision) : await adminApi.create(type, content)
      setCurrentRecord(next); notify('Draft saved. It is not public until you publish it.'); onSaved(next)
    }     catch (cause) { setError(displayAdminError(cause, 'Could not save the draft.')) }
    finally { setSaving(false) }
  }
  const publish = async () => {
    setSaving(true); setError('')
    try {
      const saved = currentRecord ? (JSON.stringify(content) === JSON.stringify(currentRecord.draftData) ? currentRecord : await adminApi.save(type, currentRecord.id, content, currentRecord.revision)) : await adminApi.create(type, content)
      setCurrentRecord(saved)
      const result = await adminApi.publish(type, saved.id, saved.revision)
      notify('Content published to the public portfolio.'); onSaved(result); onClose()
    } catch (cause) { setError(displayAdminError(cause, 'Could not publish this content.')) }
    finally { setSaving(false) }
  }
  const upload = (target) => (media) => {
    if (target === 'resume') {
      const uploadedRecord = media
      setCurrentRecord(uploadedRecord)
      setContent(uploadedRecord.draftData)
      notify('PDF uploaded and saved as a private draft. Add a title and publish when ready.')
      onSaved(uploadedRecord)
    } else if (target === 'thumbnail') set('thumbnailImage', { ...content.thumbnailImage, ...media, caption: content.thumbnailImage?.caption || '', order: 0 })
    else if (target === 'hero') set('heroImage', { ...content.heroImage, ...media, caption: content.heroImage?.caption || '', order: 0 })
    else if (target === 'gallery') set('gallery', [...(content.gallery || []), { ...media, caption: '', order: content.gallery?.length || 0 }])
    else if (target === 'logo') set('logo', { ...media, caption: '', order: 0 })
    else if (target === 'experienceImage') set('image', { ...content.image, ...media, caption: content.image?.caption || '', order: 0 })
    else if (target === 'educationImage') set('image', { ...content.image, ...media, caption: content.image?.caption || '', order: 0 })
  }
  const title = content.title || content.role || content.degree || content.fileName || 'New content'
  const projectView = type === 'projects' ? toPublicProject({ ...content, id: currentRecord?.id || 'draft-preview', status: 'published' }) : null
  const backgroundView = type === 'experiences' ? toPublicExperience({ ...content, id: currentRecord?.id || 'draft-preview' }) : type === 'education' ? toPublicEducation({ ...content, id: currentRecord?.id || 'draft-preview' }) : null
  return <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#f5f1e8]" role="dialog" aria-modal="true" aria-label={`${type} editor`}>
    <div className="sticky top-0 z-10 flex min-h-14 items-center justify-between border-b border-[#e4dfd4] bg-[#fffefa]/95 px-4 backdrop-blur"><button onClick={() => { if (window.confirm('Close this editor? Unsaved changes will be lost.')) onClose() }} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#42574a]"><ArrowLeft size={17} />Back</button><span className="max-w-[42vw] truncate text-sm font-semibold">{title}</span><button aria-label="Close editor" onClick={() => { if (window.confirm('Close this editor? Unsaved changes will be lost.')) onClose() }}><X size={20} /></button></div>
    <div className="mx-auto max-w-5xl p-4 sm:p-8">
      <PageTitle eyebrow={type.toUpperCase()} title={currentRecord ? `Edit ${title}` : `Create ${type === 'projects' ? 'project' : type === 'resumes' ? 'resume' : 'entry'}`} description="Save updates as a draft. The published version stays live until you explicitly publish the new draft." />
      <Notice message={error} error />
      <form className="grid gap-5 rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-5 shadow-sm sm:grid-cols-2 sm:p-7" onSubmit={(event) => { event.preventDefault(); save() }}>
        {type === 'projects' && <>
          <Field label="Project title"><Input required value={content.title} onChange={(event) => { setContent((old) => ({ ...old, title: event.target.value, slug: old.slug || event.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })) }} /></Field>
          <Field label="URL slug" hint="Lowercase words separated by hyphens; must be unique."><Input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={content.slug} onChange={(event) => set('slug', event.target.value.toLowerCase())} /></Field>
          <Field label="Short summary"><Input maxLength={200} value={content.synopsis} onChange={(event) => set('synopsis', event.target.value)} /></Field>
          <Field label="Category"><select className="min-h-11 rounded-lg border border-forest/15 bg-white px-3" value={content.category} onChange={(event) => set('category', event.target.value)}>{['Web', 'Mobile', 'UI/UX'].map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Role"><Input value={content.role} onChange={(event) => set('role', event.target.value)} /></Field>
          <Field label="Timeline"><Input value={content.timeline} onChange={(event) => set('timeline', event.target.value)} /></Field>
          <Field label="Full overview" className="sm:col-span-2"><Textarea className="min-h-36" value={content.executiveSummary} onChange={(event) => set('executiveSummary', event.target.value)} /></Field>
          <Field label="Problem statement"><Textarea value={content.coreProblem} onChange={(event) => set('coreProblem', event.target.value)} /></Field>
          <Field label="Objectives (one per line)"><Textarea value={lineValue(content.strategicObjectives)} onChange={(event) => set('strategicObjectives', lines(event.target.value))} /></Field>
          <Field label="Technical highlights (one per line)"><Textarea value={lineValue(content.technicalHighlights?.map((item) => item.title))} onChange={(event) => set('technicalHighlights', lines(event.target.value).map((title) => ({ title, description: '', tags: [] })))} /></Field>
          <Field label="Implementation process"><Textarea value={content.methodology} onChange={(event) => set('methodology', event.target.value)} /></Field><Field label="Impact and outcomes"><Textarea value={content.leadership} onChange={(event) => set('leadership', event.target.value)} /></Field>
          <Field label="Outcome metrics (label | value | description, one per line)"><Textarea value={lineValue(content.metrics?.map((metric) => [metric.label, metric.value, metric.description].filter(Boolean).join(' | ')))} onChange={(event) => set('metrics', lines(event.target.value).map((row) => { const [label, value, description = ''] = row.split('|').map((part) => part.trim()); return { label, value, unit: '', description } }).filter((metric) => metric.label && metric.value))} /></Field>
          <Field label="Technologies (comma separated)"><Input value={csvValue(content.techStack)} onChange={(event) => set('techStack', csv(event.target.value))} /></Field>
          <Field label="GitHub URL"><Input type="url" value={content.links.github} onChange={(event) => set('links', { ...content.links, github: event.target.value })} /></Field>
          <Field label="Live demo URL"><Input type="url" value={content.links.live} onChange={(event) => set('links', { ...content.links, live: event.target.value })} /></Field>
          <Field label="Figma URL"><Input type="url" value={content.links.figma} onChange={(event) => set('links', { ...content.links, figma: event.target.value })} /></Field>
          <Field label="Project card thumbnail"><MediaUpload onComplete={upload('thumbnail')} />{content.thumbnailImage?.url && <img className="mt-2 max-h-36 rounded-lg" src={content.thumbnailImage.url} alt="Project thumbnail preview" />}</Field>
          <Field label="Case study cover image"><MediaUpload onComplete={upload('hero')} />{content.heroImage?.url && <img className="mt-2 max-h-36 rounded-lg" src={content.heroImage.url} alt="Case study cover preview" />}</Field>
          <Field label="Interface gallery"><MediaUpload onComplete={upload('gallery')} /><div className="mt-2 flex flex-wrap gap-2">{content.gallery?.map((image, index) => <div key={`${image.storagePath}-${index}`} className="relative"><img src={image.url} alt={image.caption || `Gallery image ${index + 1}`} className="size-20 rounded object-cover" /><button type="button" className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-white shadow" onClick={() => set('gallery', content.gallery.filter((_, i) => i !== index))} aria-label={`Remove gallery image ${index + 1}`}><X size={13} /></button></div>)}</div></Field>
          <Field label="Featured project"><span className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={Boolean(content.featured)} onChange={(event) => set('featured', event.target.checked)} />Show among featured projects</span></Field>
        </>}
        {type === 'experiences' && <>
          <Field label="Role or position"><Input required value={content.role} onChange={(event) => set('role', event.target.value)} /></Field><Field label="Organization / company"><Input required value={content.company} onChange={(event) => set('company', event.target.value)} /></Field>
          <Field label="Employment type"><Input value={content.employmentType} onChange={(event) => set('employmentType', event.target.value)} /></Field><Field label="Location"><Input value={content.location} onChange={(event) => set('location', event.target.value)} /></Field>
          <Field label="Start date"><Input type="date" required value={content.startDate} onChange={(event) => set('startDate', event.target.value)} /></Field><Field label="End date"><Input type="date" disabled={content.isCurrent} value={content.endDate || ''} onChange={(event) => set('endDate', event.target.value)} /></Field>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={content.isCurrent} onChange={(event) => setContent((old) => ({ ...old, isCurrent: event.target.checked, endDate: '' }))} />Current position</label><Field label="Description"><Textarea value={content.description} onChange={(event) => set('description', event.target.value)} /></Field>
          <Field label="Responsibilities (one per line)"><Textarea value={lineValue(content.responsibilities)} onChange={(event) => set('responsibilities', lines(event.target.value))} /></Field><Field label="Achievements (one per line)"><Textarea value={lineValue(content.achievements)} onChange={(event) => set('achievements', lines(event.target.value))} /></Field>
          <Field label="Technologies / skills"><Input value={csvValue(content.skills)} onChange={(event) => set('skills', csv(event.target.value))} /></Field><Field label="Display order"><Input type="number" min="0" value={content.order} onChange={(event) => set('order', Number(event.target.value))} /></Field><Field label="Organization logo (optional)"><MediaUpload onComplete={upload('logo')} />{content.logo?.url && <img src={content.logo.url} alt="Organization logo preview" className="mt-2 size-16 rounded-lg object-cover" />}</Field>
          <Field label="Experience image (optional)"><MediaUpload onComplete={upload('experienceImage')} />{content.image?.url && <img src={content.image.url} alt="Experience image preview" className="mt-2 h-32 max-w-full rounded-lg object-cover" />}</Field>
        </>}
        {type === 'education' && <>
          <Field label="Qualification / degree"><Input required value={content.degree} onChange={(event) => set('degree', event.target.value)} /></Field><Field label="Institution"><Input required value={content.institution} onChange={(event) => set('institution', event.target.value)} /></Field>
          <Field label="Field of study"><Input value={content.fieldOfStudy || ''} onChange={(event) => set('fieldOfStudy', event.target.value)} /></Field>
          <Field label="Education image (optional)"><MediaUpload onComplete={upload('educationImage')} />{content.image?.url && <img src={content.image.url} alt="Education image preview" className="mt-2 h-32 max-w-full rounded-lg object-cover" />}</Field>
          <Field label="Start year"><Input required type="number" min="1900" max="2200" value={content.startYear} onChange={(event) => set('startYear', Number(event.target.value))} /></Field><Field label="End year (blank if ongoing)"><Input type="number" min="1900" max="2200" value={content.endYear ?? ''} onChange={(event) => set('endYear', event.target.value ? Number(event.target.value) : null)} /></Field>
          <Field label="Description"><Textarea value={content.notes} onChange={(event) => set('notes', event.target.value)} /></Field><Field label="Credential URL"><Input type="url" value={content.credentialUrl} onChange={(event) => set('credentialUrl', event.target.value)} /></Field><Field label="Display order"><Input type="number" min="0" value={content.order} onChange={(event) => set('order', Number(event.target.value))} /></Field>
        </>}
        {type === 'resumes' && <>
          {!content.storagePath && <div className="sm:col-span-2 rounded-xl border border-dashed border-forest/20 bg-[#f7faf7] p-5"><p className="mb-3 text-sm text-forest/70">PDF uploads are private until the resume is published.</p><MediaUpload kind="resume" onComplete={upload('resume')} /></div>}
          {content.storagePath && <div className="sm:col-span-2 rounded-xl border border-forest/10 bg-[#f7faf7] p-4"><p className="text-sm font-semibold">{content.fileName} <span className="font-normal text-forest/60">· {(Number(content.sizeKB || 0) / 1024).toFixed(1)} MB</span></p>{content.previewUrl && <iframe className="mt-3 h-[55vh] w-full rounded-lg border bg-white" src={content.previewUrl} title="Resume PDF preview" />}<div className="mt-3"><MediaUpload kind="resume" onComplete={upload('resume')} /></div><p className="mt-2 text-xs text-forest/55">Uploading a replacement creates a new private draft version and keeps this record available.</p></div>}
          <Field label="Resume title"><Input required value={content.title} onChange={(event) => set('title', event.target.value)} /></Field><Field label="Version"><Input value={content.version} onChange={(event) => set('version', event.target.value)} /></Field>
          <Field label="Optional description"><Textarea value={content.description} onChange={(event) => set('description', event.target.value)} /></Field><Field label="Download file name"><Input value={content.fileName} onChange={(event) => set('fileName', event.target.value)} /></Field>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={Boolean(content.isActive)} onChange={(event) => set('isActive', event.target.checked)} />Make this the active public resume when published</label>
        </>}
        <div className="sm:col-span-2 flex flex-wrap justify-between gap-3 border-t border-forest/10 pt-5"><Button onClick={() => setPreview(true)}><Eye size={15} />Preview</Button><div className="flex flex-wrap gap-2"><Button disabled={saving || (type === 'resumes' && !content.storagePath)} type="submit"><Save size={15} />{saving ? 'Saving…' : 'Save Draft'}</Button><Button kind="publish" disabled={saving || (type === 'resumes' && !content.storagePath)} onClick={publish}><Check size={15} />{saving ? 'Publishing…' : 'Publish'}</Button></div></div>
      </form>
    </div>
    {preview && <div className="fixed inset-0 z-[120] overflow-y-auto bg-[#f3f2eb]" role="dialog" aria-modal="true" aria-label="Content preview"><div className="sticky top-0 z-10 flex min-h-14 items-center justify-between bg-[#fbfaf5]/95 px-4"><span className="font-semibold">Preview · {title}</span><Button onClick={() => setPreview(false)}><X size={16} />Close preview</Button></div>{type === 'projects' ? <PortfolioProfileProvider value={profile}><ProjectDetailsPage project={projectView} /></PortfolioProfileProvider> : type === 'resumes' ? <div className="mx-auto max-w-4xl p-5"><h2 className="mb-3 font-display text-2xl">{content.title || content.fileName}</h2>{content.previewUrl ? <iframe className="h-[80vh] w-full rounded-xl border bg-white" src={content.previewUrl} title="Resume preview" /> : <p>Upload a PDF to preview it.</p>}</div> : <section className="mx-auto my-12 max-w-4xl rounded-2xl bg-soft-green p-8 sm:p-12"><p className="mb-8 text-xs font-bold uppercase tracking-widest">{type === 'education' ? 'Education' : 'Experience'}</p><BackgroundTimeline items={[backgroundView]} /></section>}</div>}
  </div>
}

function ResumeManager({ records = [], loading, error, onEdit, onCreate, onAction }) {
  const active = records.find((item) => item.status === 'published' && item.publishedData?.isActive)
  const [selectedId, setSelectedId] = useState('')
  const selected = records.find((item) => item.id === selectedId) || active || records[0]
  const document = selected?.draftData || selected?.publishedData
  const versions = [...records].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  return <>
    <PageTitle eyebrow="PORTFOLIO ASSETS & DOCUMENTS" title="Resume Management" description="Upload PDF versions, review them before publishing, and choose the active resume for your public website." action={<Button kind="primary" onClick={onCreate}><Upload size={14} />Upload new resume PDF</Button>} />
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e9e3d8] bg-[#fffefa] px-4 py-3">
      <p className="flex items-center gap-2 text-[10px] text-[#627267]"><ShieldCheck size={14} />Published resumes are available to visitors; drafts stay private until published.</p>
      <span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${active ? 'bg-[#e5efe5] text-[#45654d]' : 'bg-[#f2eee5] text-[#817562]'}`}>{error ? 'Status unavailable' : active ? 'Active version set' : 'No active version'}</span>
    </div>
    {error && <Notice error message={error} />}
    {loading ? <div className="rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-8 text-center text-[11px] text-[#74776f]" role="status">Loading resume versions…</div> : <div className="grid items-start gap-4 xl:grid-cols-[minmax(300px,.7fr)_minmax(0,1.3fr)]">
      <div className="space-y-4">
        <section className="rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-4 shadow-[0_2px_8px_rgba(52,45,32,.04)]">
          <p className="text-[9px] font-bold tracking-[.1em] text-[#77715e]">ACTIVE PORTFOLIO FILE</p>
          {active ? <><h2 className="mt-2 font-serif text-lg font-semibold text-[#1b3028]">{active.publishedData?.title || active.publishedData?.fileName}</h2><p className="mt-1 text-[10px] text-[#74776f]">{active.publishedData?.fileName} · Version {active.publishedData?.version || '1.0'}</p><a className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-md bg-[#315746] px-3 text-[10px] font-semibold text-white hover:bg-[#244b3a]" href={`/api/public/resume?id=${encodeURIComponent(active.id)}`} target="_blank" rel="noreferrer">Open public resume <ArrowUpRight size={12} /></a></> : error ? <p className="py-5 text-center text-[10px] text-[#77796f]">Resume status is unavailable until portfolio data can be loaded.</p> : <div className="py-5 text-center"><FileText size={20} className="mx-auto text-[#839286]" /><h2 className="mt-2 font-serif text-lg font-semibold text-[#34473d]">No resume published</h2><p className="mt-1 text-[10px] text-[#77796f]">Upload a PDF and publish it to add a public download link.</p></div>}
        </section>

        <section className="rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-4 shadow-[0_2px_8px_rgba(52,45,32,.04)]">
          <div className="flex items-center justify-between gap-3"><div><h2 className="font-serif text-lg font-semibold text-[#1b3028]">Upload & version update</h2><p className="mt-1 text-[10px] text-[#77796f]">PDF only · maximum 5 MB</p></div><Upload size={14} className="text-[#728576]" /></div>
          <button onClick={onCreate} className="mt-3 flex min-h-[72px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-[#cfd8ce] bg-[#f4f7f2] text-center transition hover:border-[#a9bfae] hover:bg-[#eef4ed]"><Upload size={15} className="text-[#587560]" /><span className="mt-1 text-[10px] font-semibold text-[#455c4b]">Choose a resume PDF to upload</span><span className="mt-0.5 text-[8px] text-[#7b8277]">Private until you publish · maximum 5 MB</span></button>
          <ul className="mt-3 grid gap-1.5 text-[9px] text-[#5e705f]"><li className="rounded-md bg-[#eef4ed] px-2.5 py-1.5">PDF format and file size are checked before upload</li><li className="rounded-md bg-[#eef4ed] px-2.5 py-1.5">New versions remain private until published</li></ul>
        </section>

        <section className="rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-4 shadow-[0_2px_8px_rgba(52,45,32,.04)]">
          <div className="flex items-center justify-between"><div><h2 className="font-serif text-lg font-semibold text-[#1b3028]">Version history</h2><p className="mt-0.5 text-[9px] text-[#81847b]">{error ? 'Unavailable' : `${records.length} saved version${records.length === 1 ? '' : 's'}`}</p></div><Clock3 size={14} className="text-[#829285]" /></div>
          {error ? <p className="py-6 text-center text-[10px] text-[#77796f]">Resume versions are unavailable until portfolio data can be loaded.</p> : versions.length === 0 ? <p className="py-6 text-center text-[10px] text-[#77796f]">Your first upload will start the version history.</p> : <div className="mt-2 divide-y divide-[#eee9df]">{versions.map((record) => {
            const content = record.draftData || {}
            const isActive = active?.id === record.id
            return <div key={record.id} className="flex items-center gap-2 py-2.5">
              <button onClick={() => setSelectedId(record.id)} className="min-w-0 flex-1 text-left"><span className="block truncate text-[10px] font-semibold text-[#34473d]">{content.title || content.fileName || 'Resume version'}</span><span className="mt-0.5 block text-[8px] text-[#81847b]">v{content.version || '1.0'} · {content.fileName || 'PDF'}{isActive ? ' · Active' : ''}</span></button>
              <span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${badgeStyle(record)}`}>{badge(record)}</span>
              <button onClick={() => onEdit(record)} aria-label={`Edit ${content.title || 'resume'}`} className="grid size-7 place-items-center rounded-md border border-[#e9e3d8] text-[#627267] hover:bg-[#f4f1e9]"><Settings size={12} /></button>
              {record.status === 'published' ? <button onClick={() => onAction('unpublish', record)} className="grid size-7 place-items-center rounded-md border border-[#e9e3d8] text-[#627267] hover:bg-[#f4f1e9]" aria-label="Unpublish resume"><X size={12} /></button> : <button onClick={() => onAction('publish', record)} className="grid size-7 place-items-center rounded-md border border-[#cddbcf] bg-[#edf4ed] text-[#476a58] hover:bg-[#dfeadf]" aria-label="Publish resume"><Check size={12} /></button>}
              <button onClick={() => onAction('delete', record)} className="grid size-7 place-items-center rounded-md border border-[#f0d8d2] text-[#a34f41] hover:bg-[#fff3f0]" aria-label="Delete resume"><Trash2 size={12} /></button>
            </div>
          })}</div>}
        </section>
      </div>
      <section className="overflow-hidden rounded-xl border border-[#e9e3d8] bg-[#e4e9e4] shadow-[0_2px_8px_rgba(52,45,32,.04)]">
        <div className="flex min-h-9 items-center justify-between border-b border-[#d7ded7] bg-[#fffefa] px-3"><span className="text-[9px] font-semibold text-[#626a62]">PDF preview{document?.title ? ` · ${document.title}` : ''}</span><span className="text-[8px] text-[#85877d]">{document?.previewUrl ? 'Document ready' : 'No document'}</span></div>
        {document?.previewUrl ? <iframe className="h-[min(78vh,920px)] min-h-[420px] w-full bg-[#e4e9e4]" src={document.previewUrl} title={`Resume preview ${document.title || document.fileName || ''}`} /> : <div className="grid min-h-[420px] place-items-center p-8 text-center"><div><FileText size={28} className="mx-auto text-[#78877d]" /><h2 className="mt-3 font-serif text-xl font-semibold text-[#34473d]">{error ? 'Resume preview unavailable' : records.length ? 'Select a PDF version' : 'No resume preview available'}</h2><p className="mt-1 max-w-sm text-[10px] leading-5 text-[#73786e]">{error ? 'The resume list could not be loaded from the portfolio service.' : records.length ? 'Choose a version from the history to preview its document.' : 'Upload a resume PDF to inspect it here before publishing.'}</p></div></div>}
      </section>
    </div>}
  </>
}

function MediaLibrary({ data, loading, error, onCreateProject, onEdit }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All assets')
  const assets = useMemo(() => collectMedia(data), [data])
  const shown = assets.filter((asset) => {
    const matchesSearch = `${asset.fileName} ${asset.title} ${asset.type}`.toLowerCase().includes(search.trim().toLowerCase())
    return matchesSearch && (filter === 'All assets' || (filter === 'PDFs' && asset.isResumeFile) || (filter === 'Images' && !asset.isResumeFile))
  })
  return <>
    <PageTitle eyebrow="PORTFOLIO ASSETS" title="Media Library" description="Browse the images and documents attached to your portfolio records." action={<Button kind="primary" onClick={onCreateProject}><Plus size={14} />Add project images</Button>} />
    <p className="mb-4 rounded-lg border border-[#e9e3d8] bg-[#fffefa] px-4 py-3 text-[10px] leading-5 text-[#6d746b]">Assets are stored with the project, experience, or resume that uses them. Edit the source record to replace or remove an asset.</p>
    <div className="mb-4 grid gap-3 sm:grid-cols-3"><SummaryCard label="All Assets" value={error ? '—' : assets.length} detail={error ? 'Portfolio data unavailable' : 'Unique stored media'} icon={Image} /><SummaryCard label="Images" value={error ? '—' : assets.filter((asset) => !asset.isResumeFile).length} detail={error ? 'Portfolio data unavailable' : 'Project and experience images'} icon={FolderKanban} /><SummaryCard label="PDF Documents" value={error ? '—' : assets.filter((asset) => asset.isResumeFile).length} detail={error ? 'Portfolio data unavailable' : 'Resume files'} icon={FileText} /></div>
    <div className="overflow-hidden rounded-xl border border-[#e9e3d8] bg-[#fffefa] shadow-[0_2px_8px_rgba(52,45,32,.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eee9df] px-3 py-2.5">
        <div className="flex gap-1.5" role="tablist" aria-label="Filter media assets">{['All assets', 'Images', 'PDFs'].map((value) => <button key={value} role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={`min-h-8 rounded-md px-3 text-[10px] font-semibold ${filter === value ? 'bg-[#e3edf3] text-[#365b70]' : 'text-[#626a62] hover:bg-[#f4f1e9]'}`}>{value}</button>)}</div>
        <label className="relative min-w-[190px] flex-1 sm:max-w-[300px]"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#898d83]" size={13} /><Input className="h-8 min-h-8 rounded-md border-[#e7e2d9] pl-8 text-[10px]" type="search" placeholder="Search files…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search media files" /></label>
      </div>
      {error && <div className="px-4 pt-3"><Notice error message={error} /></div>}
      {loading ? <p className="p-8 text-center text-[11px] text-[#74776f]" role="status">Loading media…</p> : error ? <p className="p-8 text-center text-[11px] text-[#74776f]" role="status">Media assets are unavailable until portfolio data can be loaded.</p> : shown.length === 0 ? <div className="p-10 text-center"><Image size={22} className="mx-auto text-[#819184]" /><h2 className="mt-3 font-serif text-xl font-semibold text-[#273b31]">{assets.length ? 'No matching files' : 'No media files yet'}</h2><p className="mt-1 text-[10px] text-[#77796f]">{assets.length ? 'Try a different search or file type.' : 'Upload an image while editing a project or experience, or add a resume PDF.'}</p>{assets.length === 0 && <Button className="mt-4" kind="primary" onClick={onCreateProject}><Plus size={14} />Create a project</Button>}</div> : <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{shown.map((asset) => <article key={asset.id} className="overflow-hidden rounded-lg border border-[#e9e3d8] bg-[#fffefa]">
        <div className="relative aspect-[4/3] overflow-hidden bg-[#e6ebe6]">{asset.isResumeFile ? <div className="grid h-full place-items-center text-[#64766a]"><FileText size={32} /><span className="mt-2 text-[9px] font-semibold tracking-wide">PDF DOCUMENT</span></div> : <img src={asset.src} alt={asset.fileName} className="h-full w-full object-cover" />}
          <span className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[8px] font-bold ${asset.version === 'published' ? 'bg-[#e5efe5] text-[#45654d]' : 'bg-[#f1eadb] text-[#806748]'}`}>{asset.version === 'published' ? 'Published' : 'Private draft'}</span>
        </div>
        <div className="p-3"><p className="truncate text-[10px] font-semibold text-[#34473d]">{asset.fileName}</p><p className="mt-1 truncate text-[9px] text-[#81847b]">{asset.title} · {asset.type === 'projects' ? 'Project' : asset.type === 'experiences' ? 'Experience' : asset.type === 'education' ? 'Education' : 'Resume'} · {asset.format}</p><div className="mt-3 flex gap-1.5"><a href={asset.src} target="_blank" rel="noreferrer" className="inline-flex min-h-7 items-center gap-1 rounded-md border border-[#e9e3d8] px-2.5 text-[9px] font-semibold text-[#5e6a60] hover:bg-[#f4f1e9]"><ExternalLink size={11} />Preview</a><button onClick={() => onEdit(asset.type, asset.record)} className="inline-flex min-h-7 items-center gap-1 rounded-md bg-[#315746] px-2.5 text-[9px] font-semibold text-white hover:bg-[#244b3a]">Edit source</button></div></div>
      </article>)}</div>}
    </div>
  </>
}

function SettingsPage({ projects = [] }) {
  const [settings, setSettings] = useState(fallbackSettings)
  const [record, setRecord] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    adminApi.getSettings()
      .then((value) => { if (!cancelled) { setRecord(value); if (value?.draftData) setSettings(value.draftData) } })
      .catch((cause) => { if (!cancelled) { setError(displayAdminError(cause, 'Could not load portfolio settings.')); setSettingsLoadFailed(true) } })
      .finally(() => { if (!cancelled) setSettingsLoaded(true) })
    return () => { cancelled = true }
  }, [])
  const set = (key, value) => setSettings((old) => ({ ...old, [key]: value }))
  const save = async () => { setBusy(true); setError(''); setNotice(''); try { const value = await adminApi.saveSettings(settings, record?.revision || 0); setRecord(value); setNotice('Portfolio settings saved as a draft.') } catch (cause) { setError(displayAdminError(cause, 'Could not save portfolio settings.')) } finally { setBusy(false) } }
  const publish = async () => { setBusy(true); setError(''); setNotice(''); try { const saved = await adminApi.saveSettings(settings, record?.revision || 0); const value = await adminApi.publishSettings(saved.revision); setRecord(value); setNotice('Portfolio settings published.') } catch (cause) { setError(displayAdminError(cause, 'Could not publish portfolio settings.')) } finally { setBusy(false) } }
  return <>
    <PageTitle eyebrow="PORTFOLIO CONFIGURATION" title="Portfolio Settings" description="Manage the profile details, social links, featured work, and search metadata used by your public portfolio." />
    <Notice message={notice} /><Notice message={error} error />
    {!settingsLoaded && <p className="mb-4 rounded-lg border border-[#e9e3d8] bg-[#fffefa] px-4 py-3 text-[11px] text-[#77796f]" role="status">Loading portfolio settings…</p>}
    {settingsLoadFailed && <p className="mb-4 rounded-lg border border-[#e9e3d8] bg-[#fffefa] px-4 py-3 text-[11px] text-[#77796f]" role="status">Settings are read-only until the current portfolio values can be loaded.</p>}
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <fieldset disabled={!settingsLoaded || settingsLoadFailed} className="contents">
      <section className="rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-5 shadow-[0_2px_8px_rgba(52,45,32,.04)]">
        <h2 className="font-serif text-lg font-semibold text-[#263b31]">Public profile</h2><p className="mb-4 mt-1 text-[10px] text-[#77796f]">Profile details displayed on your portfolio pages.</p>
        <div className="grid gap-3">
          <Field label="Portfolio name"><Input value={settings.name} onChange={(event) => set('name', event.target.value)} /></Field>
          <Field label="Professional title"><Input value={settings.title} onChange={(event) => set('title', event.target.value)} /></Field>
          <Field label="Biography"><Textarea value={settings.bio} onChange={(event) => set('bio', event.target.value)} /></Field>
          <Field label="About section"><Textarea value={settings.about} onChange={(event) => set('about', event.target.value)} /></Field>
          <Field label="Location"><Input value={settings.location} onChange={(event) => set('location', event.target.value)} /></Field>
        </div>
      </section>
      <section className="rounded-xl border border-[#e9e3d8] bg-[#fffefa] p-5 shadow-[0_2px_8px_rgba(52,45,32,.04)]">
        <h2 className="font-serif text-lg font-semibold text-[#263b31]">Social links & SEO</h2><p className="mb-4 mt-1 text-[10px] text-[#77796f]">Public profile links and search engine metadata.</p>
        <div className="grid gap-3">
          {['github', 'linkedin', 'email'].map((key) => <Field key={key} label={key === 'email' ? 'Email address or mailto link' : `${key[0].toUpperCase()}${key.slice(1)} URL`}><Input type={key === 'email' ? 'text' : 'url'} value={settings.socialLinks?.[key] || ''} onChange={(event) => set('socialLinks', { ...settings.socialLinks, [key]: event.target.value })} /></Field>)}
          <Field label="Featured projects" hint="Choose published projects to highlight on your public portfolio."><select multiple className="min-h-24 w-full rounded-lg border border-[#e5dfd2] bg-white px-3 py-2 text-xs" value={settings.featuredProjectIds || []} onChange={(event) => set('featuredProjectIds', [...event.target.selectedOptions].map((option) => option.value))}>{projects.filter((item) => item.status === 'published').map((item) => <option key={item.id} value={item.id}>{item.draftData?.title || 'Untitled project'}</option>)}</select></Field>
          <Field label="SEO page title"><Input maxLength={70} value={settings.seo?.metaTitle || ''} onChange={(event) => set('seo', { ...settings.seo, metaTitle: event.target.value })} /></Field>
          <Field label="SEO description"><Textarea value={settings.seo?.metaDescription || ''} onChange={(event) => set('seo', { ...settings.seo, metaDescription: event.target.value })} /></Field>
        </div>
      </section>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2 xl:col-span-2">
        <Button disabled={busy || !settingsLoaded || settingsLoadFailed} onClick={save}><Save size={14} />{busy ? 'Saving…' : 'Save draft'}</Button>
        <Button kind="publish" disabled={busy || !settingsLoaded || settingsLoadFailed} onClick={publish}><Check size={14} />{busy ? 'Publishing…' : 'Save & publish'}</Button>
      </div>
    </div>
  </>
}

function displayAdminError(cause, fallback) {
  if (cause?.status === 503) return 'Portfolio service setup is incomplete. Check the Cloudflare API origin and connected database and file storage configuration.'
  if (cause?.status === 502) return cause.message || 'The portfolio API returned an unexpected response. Check its deployment and routing.'
  if (!cause?.status || cause.status >= 500) return 'The portfolio service could not complete this request. Try again shortly.'
  return cause.message || fallback
}

function Workspace({ onLogout }) {
  const [route, setRoute] = useState(readRoute)
  const [locationKey, setLocationKey] = useState(window.location.search)
  const [projectSearch, setProjectSearch] = useState(() => new URLSearchParams(window.location.search).get('search') || '')
  const [data, setData] = useState({ projects: [], experiences: [], education: [], resumes: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editor, setEditor] = useState(null)
  const status = useAdminApiStatus()
  const navigate = useCallback((path) => {
    window.history.pushState({}, '', routeFor(path))
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [])
  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const entries = await Promise.all(contentTypes.map(async (type) => [type, await adminApi.list(type)]))
      setData(Object.fromEntries(entries))
    } catch (cause) {
      setError(displayAdminError(cause, 'Could not load portfolio content.'))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { refresh(); checkAdminApiHealth() }, [refresh])
  useEffect(() => {
    const sync = () => {
      setRoute(readRoute())
      setLocationKey(window.location.search)
      setProjectSearch(new URLSearchParams(window.location.search).get('search') || '')
    }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  useEffect(() => {
    if (!editor) return undefined
    const beforeUnload = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [editor])
  const notify = (message) => { setNotice(message); setTimeout(() => setNotice(''), 4500) }
  const editRecord = (type, record = null, initialPreview = false) => setEditor({ type, record, initialPreview })
  const action = async (name, record) => {
    const title = record.draftData?.title || record.draftData?.role || record.draftData?.degree || record.draftData?.fileName || 'this item'
    if (name === 'delete' && !window.confirm(`Delete “${title}”? This removes it from the public portfolio immediately and cannot be undone.`)) return
    if (name === 'unpublish' && !window.confirm('Unpublish this item? It will no longer appear on the public portfolio.')) return
    try {
      if (name === 'publish') { await adminApi.publish(record.type, record.id, record.revision); notify('Content published to the public portfolio.') }
      if (name === 'unpublish') { await adminApi.unpublish(record.type, record.id); notify('Content unpublished from the public portfolio.') }
      if (name === 'delete') { await adminApi.delete(record.type, record.id); notify('Content deleted.') }
      await refresh()
    } catch (cause) { setError(displayAdminError(cause, 'This action could not be completed.')) }
  }
  const reorder = async (type, record, delta) => {
    const values = [...(data[type] || [])]
    const index = values.findIndex((item) => item.id === record.id)
    const other = index + delta
    if (index < 0 || other < 0 || other >= values.length) return
    ;[values[index], values[other]] = [values[other], values[index]]
    try { await adminApi.reorder(type, values.map((item) => item.id)); await refresh(); notify('Display order updated.') }
    catch (cause) { setError(displayAdminError(cause, 'Display order could not be updated.')) }
  }

  let content
  if (route === 'Dashboard') content = <DashboardPage data={data} loading={loading} error={error} status={status} onNavigate={navigate} onCreateProject={() => editRecord('projects')} onCreateExperience={() => editRecord('experiences')} onCreateEducation={() => editRecord('education')} onCreateResume={() => editRecord('resumes')} />
  else if (route === 'Background & Credentials') content = <BackgroundManager data={data} loading={loading} error={error} onCreate={(type) => editRecord(type)} onEdit={(record, initialPreview = false) => editRecord(record.type, record, initialPreview)} onAction={action} onReorder={(record, delta) => reorder(record.type, record, delta)} />
  else if (route === 'Projects') content = <ProjectManagement records={data.projects} loading={loading} error={error} onCreate={() => editRecord('projects')} onEdit={(record, initialPreview = false) => editRecord('projects', record, initialPreview)} onAction={action} onReorder={(record, delta) => reorder('projects', record, delta)} globalSearch={projectSearch} locationKey={locationKey} />
  else if (route === 'Resume Management') content = <ResumeManager records={data.resumes} loading={loading} error={error} onCreate={() => editRecord('resumes')} onEdit={(record, initialPreview = false) => editRecord('resumes', record, initialPreview)} onAction={action} />
  else if (route === 'Media Library') content = <MediaLibrary data={data} loading={loading} error={error} onCreateProject={() => editRecord('projects')} onEdit={(type, record) => editRecord(type, record)} />
  else content = <SettingsPage projects={data.projects} />
  return <AdminShell active={route} onLogout={onLogout} onNavigate={navigate} projectSearch={projectSearch} onProjectSearchChange={setProjectSearch}>
    <Notice message={notice} />
    {content}
    {editor && <EditDialog key={`${editor.type}-${editor.record?.id || 'new'}-${editor.initialPreview ? 'preview' : 'edit'}`} type={editor.type} record={editor.record} initialPreview={editor.initialPreview} notify={notify} onClose={() => setEditor(null)} onSaved={refresh} />}
  </AdminShell>
}

function AdminEntry() {
  const { loading, user, logout } = useAdminAuth()
  const loginRoute = /\/login\/?$/.test(window.location.pathname)
  const next = safeAdminReturnPath(new URLSearchParams(window.location.search).get('next'))
  useEffect(() => { if (loading) return; if (!user && !loginRoute) { const current = `${window.location.pathname}${window.location.search}`; window.location.replace(`${adminLoginPath()}?${new URLSearchParams({ next: current })}`) } else if (user && loginRoute) window.location.replace(next || adminHomePath()) }, [loading, user, loginRoute, next])
  if (loading || (!user && !loginRoute)) return <main className="grid min-h-screen place-items-center bg-cream text-sm font-semibold text-forest" role="status"><span className="mb-3 size-5 animate-spin rounded-full border-2 border-forest/20 border-t-forest" />Verifying administrator access…</main>
  if (loginRoute && !user) return <AdminLogin onSuccess={() => window.location.replace(next || adminHomePath())} />
  return user ? <Workspace onLogout={logout} /> : null
}

export default function AdminApp() { return <AdminAuthProvider><AdminEntry /></AdminAuthProvider> }
