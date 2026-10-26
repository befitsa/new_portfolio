import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowUpRight, BriefcaseBusiness, Check, Eye, FileText, FolderKanban, LayoutDashboard, Menu, Plus, Save, Settings, Trash2, Upload, X } from 'lucide-react'
import { profile } from '../data/profile.js'
import { useAdminAuth, AdminAuthProvider } from '../lib/adminAuth.jsx'
import { adminApi, checkAdminApiHealth, uploadMedia, useAdminApiStatus } from '../lib/adminApi.js'
import AdminLogin, { adminHomePath, adminLoginPath, safeAdminReturnPath } from './AdminLogin.jsx'
import BrandLink from '../components/common/BrandLink.jsx'
import ProjectDetailsPage from '../components/projects/ProjectDetailsPage.jsx'
import { toPublicProject, toPublicExperience, toPublicEducation } from '../lib/db/presentation.js'
import { BackgroundTimeline } from '../components/sections/Background.jsx'
import { PortfolioProfileProvider } from '../context/PortfolioProfileContext.jsx'

const sections = ['Dashboard', 'Experience & Background', 'Projects', 'Resume', 'Settings']
const typeForTab = { Projects: 'projects', Experience: 'experiences', Education: 'education', Resume: 'resumes' }
const basePath = () => window.location.pathname.startsWith('/admin') ? '/admin' : ''
const routeFor = (path) => `${basePath()}${path === '/' ? '' : path}` || '/'
function publicPortfolioHref() {
  const configuredSubdomain = (import.meta.env.VITE_ADMIN_SUBDOMAIN || 'dev').trim().toLowerCase()
  const hostname = window.location.hostname.toLowerCase()
  if (configuredSubdomain && hostname.startsWith(`${configuredSubdomain}.`)) {
    const publicHost = hostname.slice(configuredSubdomain.length + 1)
    return `${window.location.protocol}//${publicHost}${window.location.port ? `:${window.location.port}` : ''}/`
  }
  return '/'
}
const readRoute = () => {
  const path = window.location.pathname.replace(/^\/admin/, '').replace(/\/+$/, '') || '/'
  if (path === '/background') return 'Experience & Background'
  if (path.startsWith('/projects')) return 'Projects'
  if (path === '/resume') return 'Resume'
  if (path === '/settings') return 'Settings'
  return 'Dashboard'
}
const blankProject = () => ({ title: '', slug: '', synopsis: '', executiveSummary: '', category: 'Web', role: '', timeline: '', readTime: 0, featured: false, visibility: true, order: Date.now(), thumbnailImage: { url: '', storagePath: '', mediaProvider: '', caption: '', order: 0 }, heroImage: { url: '', storagePath: '', mediaProvider: '', caption: '', order: 0 }, gallery: [], links: { github: '', figma: '', live: '' }, techStack: [], coreProblem: '', strategicObjectives: [], leadership: '', methodology: '', technicalHighlights: [], metrics: [], seo: {} })
const blankExperience = (order) => ({ role: '', company: '', logoInitials: '', startDate: new Date().toISOString().slice(0, 10), endDate: '', isCurrent: false, location: '', employmentType: '', description: '', responsibilities: [], achievements: [], logo: { url: '', storagePath: '', mediaProvider: '', caption: '', order: 0 }, skills: [], visibility: true, order })
const blankEducation = (order) => ({ degree: '', institution: '', startYear: new Date().getFullYear(), endYear: null, notes: '', credentialUrl: '', visibility: true, order })
const blankResume = (order) => ({ title: '', description: '', fileUrl: '', previewUrl: '', storagePath: '', mediaProvider: '', fileName: '', sizeKB: 0, version: '1.0', notes: '', isActive: true, visibility: true, order })
const fallbackSettings = () => ({ name: profile.name, title: profile.title, bio: profile.intro, about: profile.about, location: '', socialLinks: Object.fromEntries(profile.socials.map(({ id, url }) => [id, url])), featuredProjectIds: [], seo: { metaTitle: '', metaDescription: '' } })

function AdminShell({ children, active, onLogout }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const status = useAdminApiStatus()
  const icons = [LayoutDashboard, BriefcaseBusiness, FolderKanban, FileText, Settings]
  const route = (label) => ({ Dashboard: '/', 'Experience & Background': '/background', Projects: '/projects', Resume: '/resume', Settings: '/settings' })[label]
  const logout = async () => {
    try { await onLogout(); window.location.replace(adminLoginPath()) } catch { setLogoutError('Sign out failed. Try again.') }
  }
  return <div className="min-h-screen bg-[#f3f2eb] text-[#18352a] md:grid md:grid-cols-[245px_1fr]">
    {menuOpen && <button className="fixed inset-0 z-40 bg-black/30 md:hidden" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-forest/10 bg-[#fbfaf5] p-5 transition-transform md:sticky md:top-0 md:h-screen md:w-auto md:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <BrandLink href={routeFor('/')} ariaLabel="Fitsum admin dashboard" logoSize={34} />
      <p className="mt-9 text-[10px] font-bold tracking-[.15em] text-forest/50">PORTFOLIO</p>
      <nav className="mt-3 grid gap-1" aria-label="Admin navigation">
        {sections.map((label, index) => { const Icon = icons[index]; const selected = active === label
          return <a key={label} href={routeFor(route(label))} aria-current={selected ? 'page' : undefined} onClick={(event) => { event.preventDefault(); window.history.pushState({}, '', routeFor(route(label))); window.dispatchEvent(new PopStateEvent('popstate')); setMenuOpen(false) }} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${selected ? 'bg-[#dce8db] text-forest' : 'text-forest/70 hover:bg-forest/5 hover:text-forest'}`}><Icon size={17} />{label}</a>
        })}
      </nav>
      <div className="mt-auto border-t border-forest/10 pt-4">
        <p className="mb-3 text-xs text-forest/60" role="status">{status.label}{status.message && <span className="mt-1 block text-[10px]">{status.message}</span>}</p>
        <button onClick={logout} className="min-h-10 w-full rounded-lg border border-forest/15 px-3 text-left text-sm font-semibold hover:bg-forest/5">Logout</button>
        {logoutError && <p className="mt-2 text-xs text-red-700" role="alert">{logoutError}</p>}
      </div>
    </aside>
    <div className="min-w-0">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-forest/10 bg-[#fbfaf5]/95 px-4 backdrop-blur sm:px-8">
        <button className="grid size-10 place-items-center rounded-lg border border-forest/10 md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
        <span className="ml-auto text-xs font-medium text-forest/60">{profile.name}</span>
        <a className="ml-5 inline-flex min-h-10 items-center gap-2 rounded-full bg-forest px-4 text-xs font-semibold text-white" href={publicPortfolioHref()} target="_blank" rel="noreferrer">View site <ArrowUpRight size={14} /></a>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-8">{children}</main>
    </div>
  </div>
}

function PageTitle({ eyebrow = 'PORTFOLIO ADMIN', title, description, action }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-[10px] font-bold tracking-[.16em] text-[#a3834f]">{eyebrow}</p><h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>{description && <p className="mt-2 max-w-2xl text-sm leading-6 text-forest/65">{description}</p>}</div>{action}</div>
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

function DashboardPage({ data, loading, onCreateProject }) {
  const total = (type) => data[type]?.length || 0
  const published = (type) => data[type]?.filter((record) => record.status === 'published').length || 0
  const drafts = (type) => Math.max(0, total(type) - published(type))
  const currentResume = (data.resumes || []).find((record) => record.status === 'published' && record.publishedData?.isActive)
  return <><PageTitle title="Dashboard" description="Your portfolio content at a glance. Draft changes stay private until you publish them." />
    {loading ? <p className="rounded-xl border border-forest/10 bg-white p-6 text-sm" role="status">Loading portfolio content…</p> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ['Projects', total('projects'), `${published('projects')} published · ${drafts('projects')} drafts`], ['Experience', total('experiences'), `${published('experiences')} published · ${drafts('experiences')} drafts`], ['Education', total('education'), `${published('education')} published · ${drafts('education')} drafts`], ['Resume', currentResume ? 'Active' : 'None', currentResume?.draftData?.fileName || 'No resume published'],
      ].map(([label, count, detail]) => <article key={label} className="rounded-2xl border border-forest/10 bg-white p-5 shadow-sm"><p className="text-xs font-semibold text-forest/60">{label}</p><p className="mt-2 font-display text-3xl font-semibold">{count}</p><p className="mt-1 truncate text-xs text-forest/55">{detail}</p></article>)}</div>
      <section className="mt-7 rounded-2xl border border-forest/10 bg-white p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">Recent content</h2><p className="mt-1 text-sm text-forest/60">Create a draft, preview it, then publish when it is ready.</p></div><Button kind="primary" onClick={onCreateProject}><Plus size={16} />New project</Button></div>
        <div className="mt-5 divide-y divide-forest/10">{[...(data.projects || []), ...(data.experiences || []), ...(data.education || [])].slice(0, 6).map((record) => <div key={`${record.type}-${record.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p className="text-sm font-semibold">{record.draftData?.title || record.draftData?.role || record.draftData?.degree || 'Untitled'}</p><p className="text-xs text-forest/55">{record.type}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${badgeStyle(record)}`}>{badge(record)}</span></div>)}</div>
      </section>
    </>}
  </>
}

function ContentList({ type, records, loading, error, onEdit, onCreate, onAction, onReorder, searchable = false }) {
  const [search, setSearch] = useState('')
  const shown = useMemo(() => (records || []).filter((record) => JSON.stringify(record.draftData || {}).toLowerCase().includes(search.toLowerCase())), [records, search])
  return <>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      {searchable ? <Input className="max-w-sm" type="search" placeholder="Search projects…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search projects" /> : <span className="text-sm text-forest/60">{records?.length || 0} items</span>}
      <Button kind="primary" onClick={onCreate}><Plus size={16} />Create New</Button>
    </div>
    {error && <Notice error message={error} />}
    {loading ? <p className="rounded-xl bg-white p-6 text-sm" role="status">Loading content…</p> : shown.length === 0 ? <section className="rounded-2xl border border-dashed border-forest/20 bg-white/60 p-10 text-center"><h2 className="font-display text-xl font-semibold">Nothing here yet</h2><p className="mt-2 text-sm text-forest/60">Create your first draft to get started.</p><Button className="mt-5" kind="primary" onClick={onCreate}><Plus size={16} />Create New</Button></section> : <div className="grid gap-3">{shown.map((record, index) => {
      const data = record.draftData || {}
      const title = data.title || data.role || data.degree || data.fileName || 'Untitled'
      return <article key={record.id} className="rounded-2xl border border-forest/10 bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-display text-lg font-semibold">{title}</h2><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${badgeStyle(record)}`}>{badge(record)}</span></div><p className="mt-1 text-xs text-forest/55">{data.slug || data.company || data.institution || data.fileName || 'Draft'}{data.order !== undefined ? ` · order ${data.order}` : ''}</p></div><div className="flex flex-wrap gap-2"><Button onClick={() => onEdit(record)}>Edit / Preview</Button><Button onClick={() => onReorder(index, -1)} disabled={index === 0} aria-label="Move up">↑</Button><Button onClick={() => onReorder(index, 1)} disabled={index === shown.length - 1} aria-label="Move down">↓</Button>{record.status === 'published' ? <Button kind="light" onClick={() => onAction('unpublish', record)}>Unpublish</Button> : <Button kind="publish" onClick={() => onAction('publish', record)}><Check size={14} />Publish</Button>}<Button kind="danger" onClick={() => onAction('delete', record)}><Trash2 size={14} />Delete</Button></div></div></article>
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

function EditDialog({ type, record, onClose, onSaved, notify }) {
  const [saving, setSaving] = useState(false)
  const [content, setContent] = useState(() => structuredClone(record?.draftData || (type === 'projects' ? blankProject() : type === 'experiences' ? blankExperience(Date.now()) : type === 'education' ? blankEducation(Date.now()) : blankResume(Date.now()))))
  const [currentRecord, setCurrentRecord] = useState(record)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState('')
  const set = (key, value) => setContent((old) => ({ ...old, [key]: value }))
  const save = async () => {
    setSaving(true); setError('')
    try {
      const next = currentRecord ? await adminApi.save(type, currentRecord.id, content, currentRecord.revision) : await adminApi.create(type, content)
      setCurrentRecord(next); notify('Draft saved. It is not public until you publish it.'); onSaved(next)
    } catch (cause) { setError(cause.message || 'Could not save the draft.') }
    finally { setSaving(false) }
  }
  const publish = async () => {
    setSaving(true); setError('')
    try {
      const saved = currentRecord ? (JSON.stringify(content) === JSON.stringify(currentRecord.draftData) ? currentRecord : await adminApi.save(type, currentRecord.id, content, currentRecord.revision)) : await adminApi.create(type, content)
      setCurrentRecord(saved)
      const result = await adminApi.publish(type, saved.id, saved.revision)
      notify('Content published to the public portfolio.'); onSaved(result); onClose()
    } catch (cause) { setError(cause.message || 'Could not publish this content.') }
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
  }
  const title = content.title || content.role || content.degree || content.fileName || 'New content'
  const projectView = type === 'projects' ? toPublicProject({ ...content, id: currentRecord?.id || 'draft-preview', status: 'published' }) : null
  const backgroundView = type === 'experiences' ? toPublicExperience({ ...content, id: currentRecord?.id || 'draft-preview' }) : type === 'education' ? toPublicEducation({ ...content, id: currentRecord?.id || 'draft-preview' }) : null
  return <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#f3f2eb]" role="dialog" aria-modal="true" aria-label={`${type} editor`}>
    <div className="sticky top-0 z-10 flex min-h-14 items-center justify-between border-b border-forest/10 bg-[#fbfaf5]/95 px-4 backdrop-blur"><button onClick={() => { if (window.confirm('Close this editor? Unsaved changes will be lost.')) onClose() }} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold"><ArrowLeft size={17} />Back</button><span className="max-w-[42vw] truncate text-sm font-semibold">{title}</span><button aria-label="Close editor" onClick={() => { if (window.confirm('Close this editor? Unsaved changes will be lost.')) onClose() }}><X size={20} /></button></div>
    <div className="mx-auto max-w-5xl p-4 sm:p-8">
      <PageTitle eyebrow={type.toUpperCase()} title={currentRecord ? `Edit ${title}` : `Create ${type === 'projects' ? 'project' : type === 'resumes' ? 'resume' : 'entry'}`} description="Save updates as a draft. The published version stays live until you explicitly publish the new draft." />
      <Notice message={error} error />
      <form className="grid gap-5 rounded-2xl border border-forest/10 bg-white p-5 sm:grid-cols-2 sm:p-7" onSubmit={(event) => { event.preventDefault(); save() }}>
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
          <Field label="Technologies / skills"><Input value={csvValue(content.skills)} onChange={(event) => set('skills', csv(event.target.value))} /></Field><Field label="Organization logo (optional)"><MediaUpload onComplete={upload('logo')} />{content.logo?.url && <img src={content.logo.url} alt="Organization logo preview" className="mt-2 size-16 rounded-lg object-cover" />}</Field>
        </>}
        {type === 'education' && <>
          <Field label="Qualification / degree"><Input required value={content.degree} onChange={(event) => set('degree', event.target.value)} /></Field><Field label="Institution"><Input required value={content.institution} onChange={(event) => set('institution', event.target.value)} /></Field>
          <Field label="Start year"><Input required type="number" min="1900" max="2200" value={content.startYear} onChange={(event) => set('startYear', Number(event.target.value))} /></Field><Field label="End year (blank if ongoing)"><Input type="number" min="1900" max="2200" value={content.endYear ?? ''} onChange={(event) => set('endYear', event.target.value ? Number(event.target.value) : null)} /></Field>
          <Field label="Notes"><Textarea value={content.notes} onChange={(event) => set('notes', event.target.value)} /></Field><Field label="Credential URL"><Input type="url" value={content.credentialUrl} onChange={(event) => set('credentialUrl', event.target.value)} /></Field>
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

function ResumeManager({ records, loading, onEdit, onCreate, onAction }) {
  const active = records.find((item) => item.status === 'published' && item.publishedData?.isActive)
  return <><PageTitle title="Resume" description="Upload a PDF, save it as a private draft, preview it, and publish the version visitors should download." action={<Button kind="primary" onClick={onCreate}><Plus size={16} />Upload PDF</Button>} />
    {active && <section className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-xs font-bold uppercase tracking-wider text-emerald-900">Current public resume</p><h2 className="mt-2 font-display text-xl font-semibold">{active.publishedData.title || active.publishedData.fileName}</h2><p className="mt-1 text-sm text-emerald-900/70">{active.publishedData.fileName} · {active.publishedData.version}</p><a className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-900 px-4 text-sm font-semibold text-white" href={`/api/public/resume?id=${active.id}`} target="_blank" rel="noreferrer">Preview public download <ArrowUpRight size={15} /></a></section>}
    {loading ? <p className="rounded-xl bg-white p-6 text-sm" role="status">Loading resumes…</p> : <ContentList type="resumes" records={records} loading={false} onCreate={onCreate} onEdit={onEdit} onAction={onAction} onReorder={() => {}} />}
  </>
}

function SettingsPage({ notify }) {
  const [settings, setSettings] = useState(fallbackSettings)
  const [record, setRecord] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { adminApi.getSettings().then((value) => { setRecord(value); if (value?.draftData) setSettings(value.draftData) }).catch((cause) => setError(cause.message)) }, [])
  const set = (key, value) => setSettings((old) => ({ ...old, [key]: value }))
  const save = async () => { setBusy(true); setError(''); setNotice(''); try { const value = await adminApi.saveSettings(settings, record?.revision || 0); setRecord(value); setNotice('Settings saved as a draft.') } catch (cause) { setError(cause.message) } finally { setBusy(false) } }
  const publish = async () => { setBusy(true); setError(''); setNotice(''); try { const saved = await adminApi.saveSettings(settings, record?.revision || 0); const value = await adminApi.publishSettings(saved.revision); setRecord(value); setNotice('Settings published.') } catch (cause) { setError(cause.message) } finally { setBusy(false) } }
  return <><PageTitle title="Settings" description="Edit profile details and social links. Save and publish are separate steps." /><Notice message={notice} /><Notice message={error} error /><div className="grid gap-4 rounded-2xl border border-forest/10 bg-white p-5 sm:grid-cols-2 sm:p-7">
    <Field label="Name"><Input value={settings.name} onChange={(event) => set('name', event.target.value)} /></Field><Field label="Professional title"><Input value={settings.title} onChange={(event) => set('title', event.target.value)} /></Field>
    <Field label="Short introduction"><Textarea value={settings.bio} onChange={(event) => set('bio', event.target.value)} /></Field><Field label="About"><Textarea value={settings.about} onChange={(event) => set('about', event.target.value)} /></Field>
    <Field label="Location"><Input value={settings.location} onChange={(event) => set('location', event.target.value)} /></Field>{['github', 'linkedin', 'email'].map((key) => <Field key={key} label={`${key} link`}><Input value={settings.socialLinks?.[key] || ''} onChange={(event) => set('socialLinks', { ...settings.socialLinks, [key]: event.target.value })} /></Field>)}
    <div className="sm:col-span-2 flex flex-wrap justify-end gap-2 border-t border-forest/10 pt-4"><Button disabled={busy} onClick={save}><Save size={15} />Save Draft</Button><Button kind="publish" disabled={busy} onClick={publish}><Check size={15} />Publish Settings</Button></div>
  </div></>
}

function Workspace({ onLogout }) {
  const [route, setRoute] = useState(readRoute)
  const [data, setData] = useState({ projects: [], experiences: [], education: [], resumes: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editor, setEditor] = useState(null)
  const [tab, setTab] = useState('Experience')
  const navigate = useCallback((path) => { window.history.pushState({}, '', routeFor(path)); window.dispatchEvent(new PopStateEvent('popstate')) }, [])
  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try { const entries = await Promise.all(Object.keys(data).map(async (type) => [type, await adminApi.list(type)])); setData(Object.fromEntries(entries)) }
    catch (cause) { setError(cause.message || 'Could not load portfolio content.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { refresh(); checkAdminApiHealth() }, [refresh])
  useEffect(() => { const sync = () => setRoute(readRoute()); window.addEventListener('popstate', sync); return () => window.removeEventListener('popstate', sync) }, [])
  useEffect(() => { if (editor) { const beforeUnload = (event) => { event.preventDefault(); event.returnValue = '' }; window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload) } }, [editor])
  const notify = (message) => { setNotice(message); setTimeout(() => setNotice(''), 4500) }
  const records = data[typeForTab[tab]] || []
  const editRecord = (type, record = null) => setEditor({ type, record })
  const action = async (name, record) => {
    if (name === 'delete' && !window.confirm(`Delete “${record.draftData?.title || record.draftData?.role || record.draftData?.degree || record.draftData?.fileName || 'this item'}”? This removes it from the public portfolio immediately and cannot be undone.`)) return
    if (name === 'unpublish' && !window.confirm('Unpublish this item? It will disappear from the public portfolio.')) return
    try {
      if (name === 'publish') { await adminApi.publish(record.type, record.id, record.revision); notify('Content published.') }
      if (name === 'unpublish') { await adminApi.unpublish(record.type, record.id); notify('Content unpublished.') }
      if (name === 'delete') { await adminApi.delete(record.type, record.id); notify('Content deleted.') }
      await refresh()
    } catch (cause) { setError(cause.message || 'This action failed.') }
  }
  const reorder = async (type, index, delta) => {
    const values = [...(data[type] || [])]; const other = index + delta
    if (other < 0 || other >= values.length) return
    ;[values[index], values[other]] = [values[other], values[index]]
    try { await adminApi.reorder(type, values.map((item) => item.id)); await refresh(); notify('Display order updated.') } catch (cause) { setError(cause.message) }
  }
  let content
  if (route === 'Dashboard') content = <DashboardPage data={data} loading={loading} onCreateProject={() => editRecord('projects')} />
  else if (route === 'Experience & Background') content = <><PageTitle title="Experience & Background" description="Manage professional experience and education. Each draft remains private until you publish it." /><div className="mb-5 flex gap-2">{['Experience', 'Education'].map((value) => <button key={value} onClick={() => setTab(value)} className={`min-h-10 rounded-full px-5 text-sm font-semibold ${tab === value ? 'bg-forest text-white' : 'bg-white text-forest'}`}>{value}</button>)}</div><ContentList type={typeForTab[tab]} records={records} loading={loading} error={error} onCreate={() => editRecord(typeForTab[tab])} onEdit={(record) => editRecord(typeForTab[tab], record)} onAction={action} onReorder={(index, delta) => reorder(typeForTab[tab], index, delta)} /></>
  else if (route === 'Projects') content = <><PageTitle title="Projects" description="Manage the portfolio cards and published case study routes." /><ContentList type="projects" searchable records={data.projects} loading={loading} error={error} onCreate={() => editRecord('projects')} onEdit={(record) => editRecord('projects', record)} onAction={action} onReorder={(index, delta) => reorder('projects', index, delta)} /></>
  else if (route === 'Resume') content = <ResumeManager records={data.resumes} loading={loading} onCreate={() => editRecord('resumes')} onEdit={(record) => editRecord('resumes', record)} onAction={action} />
  else content = <SettingsPage notify={notify} />
  return <AdminShell active={route} onLogout={onLogout}><Notice message={notice} /><Notice message={error} error />{content}{editor && <EditDialog key={`${editor.type}-${editor.record?.id || 'new'}`} type={editor.type} record={editor.record} notify={notify} onClose={() => setEditor(null)} onSaved={async () => { await refresh() }} />}</AdminShell>
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
