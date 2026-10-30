import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CircleAlert, CloudUpload,
  Eye, FileText, FolderKanban, GraduationCap, Image as ImageIcon, LoaderCircle,
  Plus, RefreshCw, Save, Search, ShieldCheck, Trash2, Upload,
} from 'lucide-react'
import { categories as localCategories } from '../data/projects.js'
import { profile } from '../data/profile.js'
import MarkdownContent from '../components/common/MarkdownContent.jsx'
import { adminApi, checkCmsApiHealth, isLocalCmsMode, useCmsApiStatus } from '../lib/adminApi.js'
import { cmsHref } from './cmsPaths.js'
import { projectSchema, experienceSchema, educationSchema, normalizeProjectCategory, normalizeSkills, siteSettingsSchema } from '../lib/db/contentSchemas.js'
import { getPublicSiteUrl } from '../lib/siteUrls.js'

const EMPTY_PROJECT = {
  title: '', slug: '', synopsis: '', executiveSummary: '', category: '', role: '', timeline: '', readTime: 0,
  featured: false, visibility: true, order: 0, heroImage: { url: '', storagePath: '', caption: '', order: 0 }, gallery: [],
  links: { github: '', figma: '', live: '' }, techStack: [], coreProblem: '', strategicObjectives: [],
  leadership: '', methodology: '', technicalHighlights: [], metrics: [], seo: { metaTitle: '', metaDescription: '' },
}
const EMPTY_EXPERIENCE = { role: '', company: '', logoInitials: '', startDate: '', endDate: '', isCurrent: false, location: '', employmentType: '', description: '', skills: [], recommendationLetter: null, recommendationLetterUrl: '', visibility: true, order: 0 }
const EDUCATION_DEGREES = ['Certificate', 'Diploma', 'BSc Degree', 'MSc Degree', 'Doctorate (PhD)', 'Other']
const EMPTY_EDUCATION = { degree: '', customDegree: '', institution: '', startYear: new Date().getFullYear(), endYear: null, notes: '', credentialUrl: '', credentialImage: null, visibility: true, order: 0 }
const EMPTY_SETTINGS = {
  name: profile.name, title: profile.title, bio: profile.intro, about: profile.about, location: 'Addis Ababa, Ethiopia',
  socialLinks: Object.fromEntries(profile.socials.map(({ id, url }) => [id, url])), featuredProjectIds: [],
  seo: { metaTitle: '', metaDescription: '' },
}
const SYSTEM_FIELDS = new Set(['id', 'status', 'revision', 'publishedRevision', 'basePublishedRevision', 'createdAt', 'updatedAt', 'publishedAt', 'publishedBy', 'updatedBy', 'siteVersion', 'lastPublishedAt'])
const cleanRecord = (record = {}) => Object.fromEntries(Object.entries(record).filter(([key]) => !SYSTEM_FIELDS.has(key)))
const dateValue = (value) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
const datePretty = (value) => value ? new Date(value).toLocaleDateString() : 'Not saved yet'

function toLines(values = []) { return values.join('\n') }
function fromLines(value) { return value.split('\n').map((line) => line.trim()).filter(Boolean) }
function toHighlights(values = []) { return values.map((item) => [item.title, item.description, (item.tags || []).join(', ')].join('|')).join('\n') }
function fromHighlights(value) {
  return fromLines(value).map((line) => {
    const [title = '', description = '', tags = ''] = line.split('|')
    return { title: title.trim(), description: description.trim(), tags: tags.split(',').map((part) => part.trim()).filter(Boolean) }
  })
}
function toMetrics(values = []) { return values.map((item) => [item.label, item.value, item.unit, item.description].join('|')).join('\n') }
function fromMetrics(value) {
  return fromLines(value).map((line) => {
    const [label = '', metricValue = '', unit = '', description = ''] = line.split('|')
    return { label: label.trim(), value: metricValue.trim(), unit: unit.trim(), description: description.trim() }
  })
}
function galleryText(values = []) { return values.map((item) => `${item.url}|${item.caption || ''}`).join('\n') }
function galleryFromText(value, current = []) {
  return fromLines(value).map((line, order) => {
    const [url = '', caption = ''] = line.split('|')
    const normalizedUrl = url.trim()
    const previous = current.find((image) => image.url === normalizedUrl)
    return { url: normalizedUrl, caption: caption.trim(), storagePath: previous?.storagePath || '', order }
  })
}
function persistableProject(value, localMode) {
  if (!localMode) return value
  const persistableAsset = (asset) => asset?.url?.startsWith('blob:')
    ? { ...asset, url: `https://local-demo.invalid/${encodeURIComponent(asset.storagePath || 'preview')}` }
    : asset
  return { ...value, heroImage: persistableAsset(value.heroImage), gallery: (value.gallery || []).map(persistableAsset) }
}
function backgroundAssetPaths(value = {}) {
  return [value.credentialImage?.storagePath, value.recommendationLetter?.storagePath].filter(Boolean)
}

function PageHeader({ eyebrow, title, description, actions, showStorageNotice = true }) {
  const apiStatus = useCmsApiStatus()
  return <div className="cms-page-header"><div><p className="cms-eyebrow"><span className="cms-live-dot" />{eyebrow}</p><h1>{title}</h1><p>{description}</p>{showStorageNotice && <CmsStorageNotice status={apiStatus} />}</div>{actions && <div className="cms-page-actions">{actions}</div>}</div>
}

function Button({ children, variant = 'secondary', disabled, onClick, type = 'button', href, title, className = '', ...props }) {
  const classes = `cms-button cms-button-${variant} ${className}`.trim()
  if (href) return <a className={classes} href={cmsHref(href)} title={title} {...props}>{children}</a>
  return <button className={classes} type={type} disabled={disabled} onClick={onClick} title={title}>{children}</button>
}

function Notice({ kind = 'info', children, action }) {
  if (!children) return null
  return <div className={`cms-notice cms-notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}><CircleAlert size={16} aria-hidden="true" /><span>{children}</span>{action}</div>
}

function Field({ label, children, hint, className = '' }) {
  return <label className={`cms-field ${className}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function TextInput({ label, value, onChange, type = 'text', ...props }) {
  return <Field label={label} hint={props.hint} className={props.className}><input type={type} value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...Object.fromEntries(Object.entries(props).filter(([key]) => !['hint', 'className'].includes(key)))} /></Field>
}

function TextArea({ label, value, onChange, rows = 4, ...props }) {
  return <Field label={label} hint={props.hint} className={props.className}><textarea rows={rows} value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...Object.fromEntries(Object.entries(props).filter(([key]) => !['hint', 'className'].includes(key)))} /></Field>
}

function BackgroundImageUpload({ title, description, asset, busy, uploading, onUpload, onRemove }) {
  return <section className="cms-background-document">
    <div><h3>{title}</h3><p>{description}</p></div>
    {asset?.url && <img className="cms-background-document-preview" src={asset.url} alt={`${title} preview`} />}
    <div className="cms-upload-row">
      <label className={`cms-upload-control${busy ? ' is-busy' : ''}`}>
        <Upload size={15} /><span>{uploading ? 'Uploading image…' : asset?.storagePath ? 'Replace image' : 'Upload image'}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={busy} onChange={(event) => {
          onUpload(event.target.files?.[0])
          event.target.value = ''
        }} />
      </label>
      {asset?.storagePath && <Button className="cms-action-delete" disabled={busy} onClick={onRemove}><Trash2 size={14} /> Remove image</Button>}
      <small>JPG, JPEG, PNG, WebP · max 12 MB. Stored privately until publication.</small>
    </div>
  </section>
}

function SkillTagInput({ values, onChange, disabled }) {
  const [input, setInput] = useState('')
  const skills = normalizeSkills(values)
  const addSkill = () => {
    const skill = input.trim()
    if (!skill) return
    onChange(normalizeSkills([...skills, skill]))
    setInput('')
  }

  return <section className="cms-skill-editor" aria-label="Work experience skills">
    <div className="cms-skill-editor-heading"><strong>Skills</strong><small>Add one at a time; press Enter or use Add skill.</small></div>
    {skills.length > 0 && <ul className="cms-skill-chip-list">
      {skills.map((skill) => <li className="cms-skill-chip" key={skill}>
        <span>{skill}</span>
        <button type="button" aria-label={`Remove ${skill}`} disabled={disabled} onClick={() => onChange(skills.filter((item) => item !== skill))}><span aria-hidden="true">×</span></button>
      </li>)}
    </ul>}
    <div className="cms-skill-entry">
      <label className="cms-field"><span>Add a skill</span><input value={input} disabled={disabled} maxLength={60} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          addSkill()
        }
      }} placeholder="e.g. Network Administration" /></label>
      <Button disabled={disabled || !input.trim() || skills.some((skill) => skill.toLocaleLowerCase() === input.trim().toLocaleLowerCase())} onClick={addSkill}><Plus size={14} /> Add skill</Button>
    </div>
  </section>
}

function TagInput({ label, values, onChange, hint }) {
  return <TextArea label={label} value={toLines(values)} onChange={(value) => onChange(fromLines(value))} rows={3} hint={hint || 'Enter one value per line.'} />
}

function StatusBadge({ status }) {
  const text = status === 'published' ? 'Published' : status === 'unpublished' ? 'Unpublished' : status === 'deleted' ? 'Deleted' : 'Draft'
  return <span className={`cms-badge cms-status-badge cms-status-${status || 'draft'}`}>{text}</span>
}

function useCmsCollection(type) {
  const [state, setState] = useState({ drafts: [], published: [], loading: true, error: '' })
  const apiStatus = useCmsApiStatus()
  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }))
    try {
      const [drafts, published] = await Promise.all([adminApi.list(type, 'drafts'), adminApi.list(type, 'published')])
      setState({ drafts, published, loading: false, error: '' })
      return { drafts, published }
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }))
      return null
    }
  }, [type])
  useEffect(() => {
    if (apiStatus.ready) refresh()
    else setState((current) => ({ ...current, loading: apiStatus.checking, error: '' }))
  }, [apiStatus.checking, apiStatus.ready, refresh])
  return { ...state, refresh }
}

function useMutation() {
  const [state, setState] = useState({ busy: false, error: '', success: '' })
  const run = useCallback(async (action, success = '') => {
    setState({ busy: true, error: '', success: '' })
    try {
      const value = await action()
      setState({ busy: false, error: '', success })
      return value
    } catch (error) {
      setState({ busy: false, error: error.message || 'The operation failed.', success: '' })
      return null
    }
  }, [])
  return { ...state, run, clear: () => setState({ busy: false, error: '', success: '' }) }
}

function CmsConnectionNotice({ status }) {
  if (!status) return null
  return <Notice kind="warning">{status.message}{!status.checking && status.state !== 'unconfigured' && <Button className="cms-inline-retry" onClick={() => checkCmsApiHealth()}><RefreshCw size={14} /> Retry health check</Button>}</Notice>
}

function CmsStorageNotice({ status }) {
  if (!status || status.checking || !status.ready) return null
  const storageUnavailable = status.storageReady === false
  const publicationBlocked = status.publishReady === false
  if (!storageUnavailable && !publicationBlocked) return null
  const message = storageUnavailable
    ? status.storageMessage || 'Supabase Storage is unavailable for portfolio assets.'
    : status.publishMessage || 'Publishing is blocked until the trusted Storage review is complete.'
  return <Notice kind="warning" action={<Button href="/storage-review">Review public Storage</Button>}>{message}</Notice>
}

function ContentError({ error, retry }) {
  return <section className="cms-dashboard-panel cms-error-panel"><Notice kind="error">{error}</Notice><Button onClick={retry}><RefreshCw size={14} /> Retry connection</Button></section>
}

export function CmsDashboardPage() {
  const projects = useCmsCollection('projects')
  const experiences = useCmsCollection('experiences')
  const education = useCmsCollection('education')
  const resumes = useCmsCollection('resumes')
  const media = useCmsCollection('media')
  const apiStatus = useCmsApiStatus()
  const ready = apiStatus.ready
  const localMode = apiStatus.state === 'local'
  const [assetDiagnostics, setAssetDiagnostics] = useState([])
  const publishedProjects = projects.published.filter((item) => item.status === 'published' && item.visibility)
  const drafts = projects.drafts.filter((item) => item.status === 'draft')
  const currentResume = resumes.published.find((item) => item.isActive && item.visibility)
  const errors = [projects.error, experiences.error, education.error, resumes.error, media.error].filter(Boolean)
  const careerCount = experiences.published.filter((item) => item.status === 'published' && item.visibility).length
    + education.published.filter((item) => item.status === 'published' && item.visibility).length
  const careerDraftCount = experiences.drafts.filter((item) => item.status === 'draft').length
    + education.drafts.filter((item) => item.status === 'draft').length
  const assetIssues = assetDiagnostics.filter((item) => item.status !== 'accessible')
  useEffect(() => {
    if (!ready || localMode) {
      setAssetDiagnostics([])
      return undefined
    }

    let active = true
    const updateDiagnostics = () => {
      if (active) setAssetDiagnostics(adminApi.getStorageAssetDiagnostics())
    }
    const unsubscribe = adminApi.subscribeStorageAssetDiagnostics(updateDiagnostics)
    updateDiagnostics()
    return () => {
      active = false
      unsubscribe()
    }
  }, [ready, localMode])
  const retryAssetDiagnostics = async () => {
    adminApi.retryStorageAssetChecks()
    await Promise.all([
      projects.refresh(),
      experiences.refresh(),
      education.refresh(),
      resumes.refresh(),
      media.refresh(),
    ])
  }
  let publicUrl = ''
  try { publicUrl = getPublicSiteUrl() } catch { /* The public host may not be configured yet. */ }
  const latest = useMemo(() => {
    const byKey = new Map()
    for (const [type, records] of [
      ['projects', projects.published], ['projects', projects.drafts],
      ['experiences', experiences.published], ['experiences', experiences.drafts],
      ['education', education.published], ['education', education.drafts],
    ]) {
      for (const record of records) {
        if (record.status !== 'deleted') byKey.set(`${type}:${record.id}`, { ...record, _type: type })
      }
    }
    const timestamp = (value) => Number(value?.seconds ?? value?._seconds ?? (typeof value === 'string' ? Date.parse(value) / 1000 : 0)) || 0
    return [...byKey.values()].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt)).slice(0, 4)
  }, [projects.published, projects.drafts, experiences.published, experiences.drafts, education.published, education.drafts])

  return <>
    <PageHeader eyebrow={localMode ? 'LOCAL DEVELOPMENT · PORTFOLIO ENGINE' : 'CURATOR CONSOLE · PORTFOLIO ENGINE'} title={`Welcome back, ${profile.firstName[0] + profile.firstName.slice(1).toLowerCase()}`} description={localMode ? 'Manage a local copy of the existing portfolio. Changes stay on this device and do not reach the live website.' : ready ? apiStatus.publishReady ? 'The live CMS is connected for drafts and uploads. Publishing remains subject to the trusted Storage review.' : 'The live CMS is connected for drafts and uploads; publishing is blocked until Storage is ready and reviewed.' : 'Review the portfolio. Production content editing requires a persistent CMS provider.'} />
    {!ready && <CmsConnectionNotice status={apiStatus} />}
    {errors.length > 0 && <ContentError error={errors[0]} retry={() => [projects.refresh(), experiences.refresh(), education.refresh(), resumes.refresh(), media.refresh()]} />}
    {assetDiagnostics.length > 0 && <section className="cms-dashboard-panel cms-asset-diagnostics" aria-live="polite">
      <div className="cms-panel-heading">
        <div><h2>Storage asset diagnostics</h2><p>{assetIssues.length ? `${assetIssues.length} asset access issue${assetIssues.length === 1 ? '' : 's'} found.` : `${assetDiagnostics.length} referenced asset${assetDiagnostics.length === 1 ? '' : 's'} accessible.`}</p></div>
        {assetIssues.length > 0 && <Button onClick={retryAssetDiagnostics}><RefreshCw size={14} /> Retry failed assets</Button>}
      </div>
      <div className="cms-version-list">{assetDiagnostics.map((item, index) => <article className="cms-version-row" key={`${item.recordType}:${item.recordId}:${item.field}:${item.bucket}:${item.objectPath}:${index}`}>
        <span className={`cms-version-marker${item.status === 'accessible' ? ' is-active' : ''}`}>{item.status === 'accessible' ? <Check size={14} /> : <CircleAlert size={14} />}</span>
        <div><strong>{item.status === 'accessible' ? 'Accessible' : item.status.replaceAll('-', ' ')}</strong>
          <small>{item.recordType} · record {item.recordId} · field {item.field}</small>
          <small>Bucket {item.bucket} · object {item.objectPath}</small>
          <small>Recommended action: {item.recommendedAction}</small>
          {item.status !== 'accessible' && <a className="cms-quiet-link" href={cmsHref(
            item.recordType === 'projects'
              ? `/projects/${encodeURIComponent(item.recordId)}`
              : item.recordType === 'experiences' || item.recordType === 'education'
                ? '/background'
                : item.recordType === 'resumes'
                  ? '/resume'
                  : '/media',
          )}>Open record to replace or investigate</a>}
        </div>
      </article>)}</div>
    </section>}
    <section className="cms-welcome-card cms-dashboard-welcome"><div><span className="cms-dashboard-kicker"><ShieldCheck size={15} /> {localMode ? 'LOCAL PREVIEW' : 'CURATOR CONSOLE'}</span><h2>Your portfolio workspace</h2><p>{localMode ? 'Create, edit, and remove local records. Local publish actions update only the local public preview.' : ready ? 'Your connected CMS provider can save drafts and manage private uploads. Publishing remains protected by the Storage audit gate.' : apiStatus.message}</p></div><div className="cms-welcome-status"><strong className={ready && !errors.length ? 'is-ready' : ''}>{localMode ? 'Local JSON + disk ready' : ready && !errors.length ? 'Persistent provider connected' : apiStatus.label}</strong><p>{localMode ? 'Records are saved in local JSON files; uploads are stored on disk.' : ready ? apiStatus.publishReady ? 'Content API is connected; publishing is ready.' : apiStatus.publishMessage || 'Content API is connected; publishing needs Storage review.' : apiStatus.message}</p></div></section>
    <div className="cms-quick-actions"><span className="cms-section-kicker">QUICK ACTIONS</span><Button variant="primary" href="/projects/new"><Plus size={15} /> Add Project</Button><Button href="/background"><Plus size={15} /> Add Experience</Button><Button href="/resume"><Upload size={15} /> Upload Resume</Button><Button href="/media"><ImageIcon size={15} /> Manage Media</Button></div>
    <section className="cms-stats-grid">
      <StatCard icon={FolderKanban} label="PORTFOLIO WORKS" value={publishedProjects.length} detail={`${drafts.length} project drafts pending`} badge={localMode ? 'Local preview' : ready ? 'Live data' : 'Published entries'} tone={ready ? 'green' : 'neutral'} />
      <StatCard icon={GraduationCap} label="CAREER & ACADEMICS" value={careerCount} detail={`${careerDraftCount} drafts awaiting review`} badge={ready ? 'Published entries' : 'Published entries'} tone="green" />
      <StatCard icon={FileText} label="DOCUMENT HUB" value={currentResume?.version ? `v${currentResume.version}` : 'No active PDF'} detail={currentResume?.fileName || 'Upload a PDF version to activate it'} badge={currentResume ? 'Published' : 'Needs setup'} tone={currentResume ? 'green' : 'amber'} />
      <StatCard icon={ImageIcon} label="MANAGED MEDIA" value={media.published.length} detail={localMode ? 'Images saved on this machine' : 'Images stored in managed object storage'} badge={localMode ? 'Library' : apiStatus.storageReady ? 'Storage reachable' : 'Unavailable'} tone={localMode || apiStatus.storageReady ? 'green' : 'neutral'} />
    </section>
    <div className="cms-dashboard-columns"><section className="cms-dashboard-panel"><div className="cms-panel-heading"><div><h2>Recent content activity</h2><p>{localMode ? 'Latest changes saved in local JSON files.' : 'Latest saved records from Supabase.'}</p></div><a href={cmsHref('/projects')} className="cms-quiet-link">View projects <ArrowRight size={14} /></a></div>{latest.length ? <div className="cms-record-list">{latest.map((record) => <a key={`${record._type}-${record.id}`} className="cms-record-row" href={cmsHref(record._type === 'projects' ? `/projects/${record.id}` : '/background')}><span className="cms-snapshot-icon"><FileText size={16} /></span><span><strong>{record.title || record.role || record.degree || record.company || 'Portfolio record'}</strong><small>{record.company || record.institution || record.category || record._type} · {datePretty(record.updatedAt?.seconds || record.updatedAt?._seconds ? new Date((record.updatedAt.seconds ?? record.updatedAt._seconds) * 1000).toISOString().slice(0, 10) : '')}</small></span><StatusBadge status={record.status} /></a>)}</div> : <EmptyState title={ready ? 'No recent records' : 'Connect Supabase'} text={ready ? 'Create a project or background entry to see activity here.' : 'Dashboard metrics update after the Supabase connection is configured.'} />}</section>
      <div className="cms-dashboard-side"><section className="cms-dashboard-panel cms-preview-panel"><div className="cms-panel-heading"><div><h2>Website preview</h2><p>{localMode ? 'Public page on this development server.' : 'Current public portfolio.'}</p></div><span className="cms-badge cms-badge-green">{localMode ? 'Local preview' : 'Live site'}</span></div><div className="cms-site-preview"><div className="cms-preview-browserbar"><span /><span /><span /><small>Fitsum Mesfin</small></div><div className="cms-preview-content"><span className="cms-preview-avatar">FM</span><h3>{profile.name}</h3><p>{profile.title} · {profile.roles.slice(0, 2).join(' · ')}</p><div className="cms-preview-projects">{publishedProjects.slice(0, 2).map((item) => <span key={item.id}>{item.title}</span>)}</div></div></div>{publicUrl ? <Button className="cms-preview-link" variant="primary" href={publicUrl} target="_blank" rel="noreferrer">{localMode ? 'Open local portfolio preview' : 'Open live portfolio'} <ArrowRight size={14} /></Button> : <p className="cms-inline-hint">Set VITE_PUBLIC_PORTFOLIO_URL to open the public portfolio.</p>}</section><section className="cms-integration-card"><div className="cms-integration-title"><ShieldCheck size={18} /><h2>{localMode ? 'Development storage' : 'Production CMS provider'}</h2></div><div className="cms-integration-row"><span>Admin interface</span><strong className="is-ready">{localMode ? 'Local only' : 'Supabase Auth'}</strong></div><div className="cms-integration-row"><span>{localMode ? 'Text records' : 'Content API'}</span><strong>{localMode ? 'Local JSON files' : ready ? 'Connected' : apiStatus.state === 'unconfigured' ? 'Not configured' : 'Unavailable'}</strong></div><div className="cms-integration-row"><span>{localMode ? 'Uploaded files' : 'Persistent storage'}</span><strong>{localMode ? 'Local disk' : apiStatus.storageReady ? 'Reachable' : apiStatus.state === 'checking' ? 'Checking' : 'Unavailable'}</strong></div><div className="cms-integration-row"><span>Publishing</span><strong>{localMode ? 'Local preview' : apiStatus.publishReady ? 'Ready' : ready ? 'Review required' : 'Unavailable'}</strong></div><p className="cms-integration-note">{localMode ? 'Development changes are saved under .local-cms on this machine and never sent to the live website.' : 'Supabase Content API status is based on the authenticated CMS health RPC; Storage status verifies authenticated bucket listing. Publishing additionally requires its server-side readiness gate and trusted Storage audit.'}</p></section></div>
    </div>
  </>
}

function StatCard({ icon: Icon, label, value, detail, badge, tone }) {
  return <article className="cms-stat-card"><div className="cms-stat-topline"><span className="cms-stat-icon"><Icon size={19} /></span><span className={`cms-badge cms-badge-${tone}`}>{badge}</span></div><p className="cms-stat-label">{label}</p><p className="cms-stat-value">{value}</p><p className="cms-stat-detail">{detail}</p></article>
}

function EmptyState({ title, text, action }) {
  return <div className="cms-empty-state"><span className="cms-empty-icon"><FolderKanban size={18} /></span><strong>{title}</strong><p>{text}</p>{action}</div>
}

export function CmsProjectsPage() {
  const { drafts, published, loading, error, refresh } = useCmsCollection('projects')
  const mutation = useMutation()
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q') || '')
  const [filter, setFilter] = useState(() => new URLSearchParams(window.location.search).get('status') || 'all')
  const apiStatus = useCmsApiStatus()
  const ready = apiStatus.ready
  const canReorder = filter === 'all' && !search.trim()
  const records = useMemo(() => {
    const byId = new Map(drafts.map((record) => [record.id, record]))
    for (const item of published) if (!byId.has(item.id)) byId.set(item.id, item)
    return [...byId.values()].filter((item) => item.status !== 'deleted').filter((item) => {
      const stateOk = filter === 'all' || (filter === 'published' && published.some((record) => record.id === item.id && record.status === 'published')) || (filter === 'draft' && item.status === 'draft') || (filter === 'featured' && item.featured)
      return stateOk && `${item.title} ${item.slug} ${(item.techStack || []).join(' ')}`.toLowerCase().includes(search.toLowerCase())
    }).sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
  }, [drafts, published, filter, search])

  const changeOrder = async (record, delta) => {
    const currentIndex = records.findIndex((item) => item.id === record.id)
    const targetIndex = currentIndex + delta
    if (targetIndex < 0 || targetIndex >= records.length) return
    const moved = [...records]
    ;[moved[currentIndex], moved[targetIndex]] = [moved[targetIndex], moved[currentIndex]]
    const result = await mutation.run(() => adminApi.reorder('projects', moved.map((item, order) => ({ id: item.id, expectedRevision: item.revision, order }))), 'Display order saved as a private draft.')
    if (result) refresh()
  }
  const publish = async (record) => {
    const summary = record.synopsis || record.executiveSummary || 'This project has no summary yet.'
    const visibility = record.visibility ? 'It will be visible on the public portfolio.' : 'It will be published but remain hidden from public listings.'
    if (!window.confirm(`Review project publish\n\n${record.title}\n${record.category || 'Portfolio project'}\n${summary}\n\n${visibility}\n\nPublish this selected revision?`)) return
    const result = await mutation.run(() => adminApi.publish('projects', record.id, record.revision), 'Project published to the portfolio.')
    if (result) refresh()
  }
  const unpublish = async (record) => {
    if (!window.confirm(`Unpublish “${record.title}”? It will be removed from the public site, with its history kept.`)) return
    const result = await mutation.run(() => adminApi.unpublish('projects', record.id), 'Project unpublished.')
    if (result) refresh()
  }
  const deleteProject = async (record) => {
    if (!window.confirm(`Delete ${record.title}? It will be removed from the public portfolio, with its history kept.`)) return
    const result = await mutation.run(() => adminApi.deleteItem('projects', record.id), 'Project deleted and its history retained.')
    if (result) refresh()
  }

  return <><PageHeader eyebrow="EDITORIAL CMS REGISTRY" title="Projects & Case Studies" description="Curate, edit, preview, and publish engineering projects to your public showcase." actions={<Button variant="brown" href="/projects/new"><Plus size={15} /> Create New Project</Button>} />
    {!ready && <CmsConnectionNotice status={apiStatus} />}{error && <ContentError error={error} retry={refresh} />}{mutation.error && <Notice kind="error">{mutation.error}</Notice>}{mutation.success && <Notice kind="success">{mutation.success}</Notice>}
    <div className="cms-toolbar"><div className="cms-filter-pills">{[['all', 'All Projects'], ['published', 'Published'], ['draft', 'Drafts'], ['featured', 'Featured']].map(([value, label]) => <button key={value} className={`cms-filter-pill${filter === value ? ' is-active' : ''}`} onClick={() => setFilter(value)}>{label}<span>{value === 'all' ? records.length : value === 'published' ? published.filter((item) => item.status === 'published').length : value === 'draft' ? drafts.filter((item) => item.status === 'draft').length : drafts.filter((item) => item.featured).length}</span></button>)}</div><label className="cms-search cms-toolbar-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, stack, slug…" aria-label="Search projects" /></label></div>
    {loading ? <LoadingPanel /> : records.length ? <div className="cms-project-layout"><div className="cms-project-list">{records.map((record, index) => {
      const isPublished = published.some((item) => item.id === record.id && item.status === 'published' && item.visibility)
      return <article key={record.id} className="cms-project-card"><div className="cms-project-thumbnail">{record.heroImage?.url ? <img src={record.heroImage.url} alt="" /> : <div><FolderKanban size={25} /><span>Project cover</span></div>}{record.featured && <span className="cms-featured-label">Featured</span>}</div><div className="cms-project-copy"><div className="cms-project-meta"><span>{record.category || 'Portfolio project'}</span><StatusBadge status={record.status} />{isPublished && <span className="cms-badge cms-status-published">Live</span>}</div><h2>{record.title || 'Untitled project'}</h2><code>/projects/{record.slug}</code><p>{record.synopsis || record.executiveSummary || 'Add a concise project summary.'}</p><div className="cms-tag-list">{(record.techStack || []).slice(0, 6).map((tag) => <span key={tag}>{tag}</span>)}</div><div className="cms-project-actions"><Button className="cms-action-edit" href={`/projects/${record.id}`}><Save size={14} /> Edit case study</Button>{isPublished ? <Button className="cms-action-unpublish" disabled={!ready || mutation.busy} onClick={() => unpublish(record)}>Unpublish</Button> : <Button className="cms-action-publish" variant="brown" disabled={!ready || mutation.busy || record.status !== 'draft'} onClick={() => publish(record)}><CloudUpload size={14} /> Publish</Button>}<Button className="cms-square-button" title="Move earlier (clear filters to reorder)" disabled={!ready || mutation.busy || !canReorder || index === 0} onClick={() => changeOrder(record, -1)}><ArrowUp size={14} /></Button><Button className="cms-square-button" title="Move later (clear filters to reorder)" disabled={!ready || mutation.busy || !canReorder || index === records.length - 1} onClick={() => changeOrder(record, 1)}><ArrowDown size={14} /></Button><Button className="cms-square-button cms-action-delete" title="Delete project and retain history" disabled={!ready || mutation.busy} onClick={() => deleteProject(record)}><Trash2 size={14} /></Button></div></div></article>
    })}</div><aside className="cms-studio-card"><span className="cms-studio-dot" /><div><h2>Project Studio</h2><p>{records.length} project records · {published.filter((item) => item.status === 'published').length} published</p></div><div className="cms-studio-help"><ShieldCheck size={17} /><p>Saving a draft preserves the public version. Publishing copies the validated draft into the public collection.</p></div><Button variant="primary" href="/projects/new"><Plus size={15} /> Start a new case study</Button></aside></div> : <EmptyState title={ready ? 'No projects match this view' : 'CMS provider not configured'} text={ready ? 'Create a case study or adjust your filters.' : 'Production editing is unavailable until a persistent CMS API provider is configured.'} action={ready ? <Button variant="brown" href="/projects/new"><Plus size={14} /> Create project</Button> : null} />}
  </>
}

export function CmsProjectEditorPage({ id }) {
  const isNew = !id || id === 'new'
  const { published } = useCmsCollection('projects')
  const mutation = useMutation()
  const [record, setRecord] = useState(null)
  const [form, setForm] = useState(EMPTY_PROJECT)
  const [savedContent, setSavedContent] = useState(null)
  const [loading, setLoading] = useState(!isNew)
  const [loadError, setLoadError] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [preview, setPreview] = useState(false)
  const [markdownPreview, setMarkdownPreview] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [progress, setProgress] = useState(0)
  const [heroPreviewUrl, setHeroPreviewUrl] = useState('')
  const [uploadPlacement, setUploadPlacement] = useState('form')
  const heroImageInput = useRef(null)
  const apiStatus = useCmsApiStatus()
  const ready = apiStatus.ready
  const localMode = isLocalCmsMode()
  useEffect(() => () => {
    if (heroPreviewUrl) URL.revokeObjectURL(heroPreviewUrl)
  }, [heroPreviewUrl])
  useEffect(() => {
    if (isNew) return
    if (!ready) {
      setLoading(apiStatus.checking)
      setLoadError('')
      return undefined
    }
    let active = true
    setLoading(true)
    setLoadError('')
    adminApi.get('projects', id).then(async (draft) => {
      const value = draft || await adminApi.get('projects', id, 'published')
      if (active && value) {
        const nextForm = { ...EMPTY_PROJECT, ...cleanRecord(value), category: normalizeProjectCategory(value.category), heroImage: { ...EMPTY_PROJECT.heroImage, ...(value.heroImage || {}) }, links: { ...EMPTY_PROJECT.links, ...(value.links || {}) }, seo: { ...EMPTY_PROJECT.seo, ...(value.seo || {}) } }
        setRecord(value); setForm(nextForm); setSavedContent(projectSchema.parse(persistableProject(nextForm, localMode))); setSlugEdited(true)
      }
    }).catch((error) => { if (active) setLoadError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [apiStatus.checking, id, isNew, ready])
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const setNested = (group, key, value) => setForm((current) => ({ ...current, [group]: { ...current[group], [key]: value } }))
  const setTitle = (value) => {
    setForm((current) => ({ ...current, title: value, slug: slugEdited ? current.slug : value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) }))
  }
  const parse = () => {
    const value = { ...form, readTime: Number(form.readTime || 0), order: Number(form.order || 0), strategicObjectives: Array.isArray(form.strategicObjectives) ? form.strategicObjectives : [], technicalHighlights: Array.isArray(form.technicalHighlights) ? form.technicalHighlights : [], metrics: Array.isArray(form.metrics) ? form.metrics : [] }
    return projectSchema.parse(persistableProject(value, localMode))
  }
  let hasUnsavedChanges = !record && JSON.stringify(form) !== JSON.stringify(EMPTY_PROJECT)
  if (record) {
    try { hasUnsavedChanges = !savedContent || JSON.stringify(parse()) !== JSON.stringify(savedContent) } catch { hasUnsavedChanges = true }
  }
  useEffect(() => {
    if (!hasUnsavedChanges) return undefined
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasUnsavedChanges])
  const save = async (publish = false) => {
    if (publish && !window.confirm(`Review project publish\n\n${form.title || 'Untitled project'}\n${form.category || 'Portfolio project'}\n${form.synopsis || form.executiveSummary || 'No summary provided.'}\n\n${localMode ? 'This updates only the local public preview on this device. It will not update the live website.' : 'Publish this selected revision to the public portfolio?'}`)) return
    let content
    try { content = parse() } catch (error) { mutation.clear(); setLoadError(error.issues?.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' · ') || error.message); return }
    setLoadError('')
    const saved = await mutation.run(async () => {
      const next = record ? await adminApi.save('projects', record.id, content, record.revision) : await adminApi.create('projects', content)
      setRecord(next)
      setSavedContent(content)
      if (!record) window.history.replaceState({}, '', cmsHref(`/projects/${next.id}`))
      if (publish) await adminApi.publish('projects', next.id, next.revision)
      return next
    }, publish ? (localMode ? 'Project added to the local public preview.' : 'Project published successfully.') : (localMode ? 'Draft saved to local JSON.' : 'Draft saved.'))
    if (saved && publish) { const refreshed = await adminApi.get('projects', saved.id); if (refreshed) setRecord(refreshed) }
  }
  const uploadHero = async (file) => {
    if (!file) return
    if (!localMode && apiStatus.storageReady === false) {
      await mutation.run(() => { throw new Error(apiStatus.storageMessage || 'Supabase Storage is unavailable. Check portfolio-published and portfolio-private, plus the separate legacy IDs "portfolio_media", "portfolio-media", and "portfolio-media.".') })
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 12 * 1024 * 1024) {
      await mutation.run(() => { throw new Error('Choose a JPEG, PNG, or WebP image larger than 0 bytes and no larger than 12 MB.') })
      return
    }
    try {
      setHeroPreviewUrl(URL.createObjectURL(file))
    } catch (error) {
      await mutation.run(() => { throw new Error(`Could not preview the selected image: ${error.message}`) })
      return
    }
    setProgress(1)
    const uploaded = await mutation.run(() => adminApi.upload(file, { kind: 'image', onProgress: setProgress }), localMode ? 'Hero image saved to local disk.' : 'Hero image uploaded to private draft storage.')
    setProgress(0)
    setHeroPreviewUrl('')
    if (uploaded) setForm((current) => ({ ...current, heroImage: { ...current.heroImage, url: uploaded.url, storagePath: uploaded.storagePath } }))
  }
  const chooseHeroImage = (event) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    void uploadHero(file)
  }
  const importHero = async () => {
    if (!imageUrl.trim()) return
    if (!localMode && apiStatus.storageReady === false) {
      await mutation.run(() => { throw new Error(apiStatus.storageMessage || 'Supabase Storage is unavailable. Check portfolio-published and portfolio-private, plus the separate legacy IDs "portfolio_media", "portfolio-media", and "portfolio-media.".') })
      return
    }
    const imported = await mutation.run(() => adminApi.importImage(imageUrl.trim()), localMode ? 'Image URL added to the local media library.' : 'Image copied to private draft storage.')
    if (imported) { setForm((current) => ({ ...current, heroImage: { ...current.heroImage, url: imported.url, storagePath: imported.storagePath } })); setImageUrl('') }
  }
  const slugConflict = form.slug && published.some((item) => item.slug === form.slug && item.id !== id)
  if (loading) return <LoadingPanel />
  const creating = !record
  if (loadError && !record && !isNew) return <><PageHeader eyebrow="PROJECT STUDIO" title="Project not available" description={loadError} /><Button href="/projects"><ArrowLeft size={14} /> Back to projects</Button></>
  return <><PageHeader eyebrow={localMode ? 'LOCAL PROJECT STUDIO · DEVELOPMENT COPY' : 'PROJECT STUDIO · EDITORIAL CASE STUDY'} title={creating ? 'Create new project' : `Edit ${form.title || 'project'}`} description={localMode ? 'Edit portfolio content and preview published changes on this device.' : 'Build the public case study while keeping saved draft changes private until you publish.'} actions={<Button href="/projects"><ArrowLeft size={14} /> All projects</Button>} />
    {!ready && <CmsConnectionNotice status={apiStatus} />}{mutation.error && <Notice kind="error">{mutation.error}</Notice>}{mutation.success && <Notice kind="success">{mutation.success}</Notice>}{loadError && <Notice kind="error">{loadError}</Notice>}{slugConflict && <Notice kind="error">This slug is already used by a published project.</Notice>}
    <div className="cms-editor-layout"><form className="cms-editor-main" onSubmit={(event) => { event.preventDefault(); save(false) }}>
      <section className="cms-editor-card"><div className="cms-section-heading"><span className="cms-step-number">00</span><div><h2>Project identity & core taxonomy</h2><p>Core information shown in project cards and search.</p></div></div><div className="cms-field-grid"><TextInput label="Project title *" value={form.title} onChange={setTitle} maxLength={120} required /><TextInput label="Project slug *" value={form.slug} onChange={(value) => { setSlugEdited(true); set('slug', value.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/--+/g, '-')) }} maxLength={120} required hint={`/projects/${form.slug || 'your-project-slug'}`} /><Field label="Category *"><select required value={form.category} onChange={(event) => set('category', event.target.value)}><option value="">Choose a category</option>{localCategories.filter((category) => category !== 'All').map((category) => <option key={category} value={category}>{category}</option>)}</select></Field><TextInput label="My role" value={form.role} onChange={(value) => set('role', value)} /><TextInput label="Project timeline" value={form.timeline} onChange={(value) => set('timeline', value)} placeholder="4 Months (Q2 2025)" /><TextInput label="Display order" type="number" value={form.order} onChange={(value) => set('order', Number(value))} min="0" /></div><TagInput label="Technology stack" values={form.techStack} onChange={(value) => set('techStack', value)} hint="One technology per line." /><div className="cms-inline-toggles"><label><input type="checkbox" checked={form.featured} onChange={(event) => set('featured', event.target.checked)} /> Featured project</label><label><input type="checkbox" checked={form.visibility} onChange={(event) => set('visibility', event.target.checked)} /> Visible after publishing</label></div></section>
      <section className="cms-editor-card"><div className="cms-section-heading"><span className="cms-step-number">01</span><div><h2>Overview & case study foundation</h2><p>Narrative content for the long-form project page.</p></div></div><TextArea label="Card summary" value={form.synopsis} onChange={(value) => set('synopsis', value)} rows={3} maxLength={200} hint={`${form.synopsis.length}/200 characters`} /><TextArea label="Executive summary (Markdown)" value={form.executiveSummary} onChange={(value) => set('executiveSummary', value)} rows={5} maxLength={12000} hint="Supports headings, lists, emphasis, inline code, links, and fenced code blocks." /><Button onClick={() => setMarkdownPreview((value) => !value)}><Eye size={14} /> {markdownPreview ? 'Hide Markdown preview' : 'Preview Markdown'}</Button>{markdownPreview && <div className="cms-markdown-preview"><MarkdownContent source={form.executiveSummary} /></div>}<TextArea label="Core problem" value={form.coreProblem} onChange={(value) => set('coreProblem', value)} rows={4} /><TagInput label="Strategic objectives" values={form.strategicObjectives} onChange={(value) => set('strategicObjectives', value)} /><TextArea label="Leadership & responsibilities" value={form.leadership} onChange={(value) => set('leadership', value)} rows={4} /><TextArea label="Development methodology" value={form.methodology} onChange={(value) => set('methodology', value)} rows={4} /></section>
      <section className="cms-editor-card"><div className="cms-section-heading"><span className="cms-step-number">02</span><div><h2>Technical highlights & outcomes</h2><p>Use one item per line; separate fields with a vertical bar.</p></div></div><TextArea label="Technical highlights · Title | Description | tags separated by commas" value={toHighlights(form.technicalHighlights)} onChange={(value) => set('technicalHighlights', fromHighlights(value))} rows={5} /><TextArea label="Impact metrics · Label | value | unit | description" value={toMetrics(form.metrics)} onChange={(value) => set('metrics', fromMetrics(value))} rows={4} /></section>
      <section className="cms-editor-card"><div className="cms-section-heading"><span className="cms-step-number">03</span><div><h2>Cover canvas & gallery</h2><p>{localMode ? 'Choose a cover image from your computer. It is saved under .local-cms/uploads and remains available after refresh or restart.' : 'Choose a cover image from your computer. It is uploaded to managed storage and attached when you save the project.'}</p></div></div>{(heroPreviewUrl || form.heroImage.url) && <div className="cms-hero-image-preview"><img src={heroPreviewUrl || form.heroImage.url} alt={form.heroImage.caption || 'Project cover canvas preview'} /><Button className="cms-action-delete" disabled={mutation.busy} onClick={() => { setHeroPreviewUrl(''); setForm((current) => ({ ...current, heroImage: { ...current.heroImage, url: '', storagePath: '' } })) }}><Trash2 size={14} /> Remove cover</Button></div>}<div className="cms-upload-row"><label className={`cms-upload-control${mutation.busy ? ' is-busy' : ''}`}><Upload size={17} /><span>{mutation.busy ? 'Uploading cover canvas…' : form.heroImage.url ? 'Replace Cover Canvas' : 'Choose Cover Canvas image'}</span><input ref={heroImageInput} aria-label="Upload Cover Canvas image" type="file" accept="image/jpeg,image/png,image/webp" disabled={!ready || mutation.busy} onChange={chooseHeroImage} /></label><span>JPEG, PNG, WebP · max 12 MB</span></div>{progress > 0 && uploadPlacement === 'form' && <div className="cms-upload-status" role="status"><progress className="cms-upload-progress" max="100" value={progress} /><span>Uploading Cover Canvas · {progress}%</span></div>}<div className="cms-inline-import"><TextInput label={localMode ? 'Reference image URL' : 'Import permitted image URL'} value={imageUrl} onChange={setImageUrl} type="url" placeholder="https://…" /><Button className="cms-action-preview" disabled={!ready || mutation.busy || !imageUrl.trim()} onClick={importHero}>{localMode ? 'Use URL' : <><CloudUpload size={14} /> Import image</>}</Button><Button className="cms-action-edit" href="/media"><ImageIcon size={14} /> Media Library</Button></div><TextInput label="Cover image caption / alt text" value={form.heroImage.caption} onChange={(value) => setNested('heroImage', 'caption', value)} maxLength={300} /><TextArea label="Gallery · one URL per line; optionally add |caption" value={galleryText(form.gallery)} onChange={(value) => set('gallery', galleryFromText(value, form.gallery))} rows={5} hint="Use managed URLs from Media Library when possible." /></section>
      <section className="cms-editor-card"><div className="cms-section-heading"><span className="cms-step-number">04</span><div><h2>Project links & SEO</h2><p>External destinations and search preview metadata.</p></div></div><div className="cms-field-grid"><TextInput label="GitHub repository URL" value={form.links.github} onChange={(value) => setNested('links', 'github', value)} type="url" /><TextInput label="Figma prototype URL" value={form.links.figma} onChange={(value) => setNested('links', 'figma', value)} type="url" /><TextInput label="Live project URL" value={form.links.live} onChange={(value) => setNested('links', 'live', value)} type="url" /><TextInput label="SEO title" value={form.seo.metaTitle} onChange={(value) => setNested('seo', 'metaTitle', value)} maxLength={70} /><TextArea className="cms-field-full" label="SEO description" value={form.seo.metaDescription} onChange={(value) => setNested('seo', 'metaDescription', value)} rows={3} maxLength={180} /></div></section>
      <div className="cms-editor-actions"><span>{hasUnsavedChanges ? 'Unsaved changes' : record ? `${record.status === 'published' ? 'Published version unchanged.' : 'Draft saved'} · v${record.revision}` : 'New project · not saved yet'}</span><Button type="submit" disabled={!ready || mutation.busy || Boolean(slugConflict)}><Save size={15} /> Save draft</Button><Button disabled={!ready || mutation.busy || !form.title || Boolean(slugConflict)} onClick={() => save(true)} variant="brown"><CloudUpload size={15} /> Save & publish</Button><Button disabled={!form.title} onClick={() => setPreview((value) => !value)}><Eye size={15} /> {preview ? 'Hide preview' : 'Preview draft'}</Button></div>
    </form><aside className="cms-editor-aside"><section className="cms-editor-card cms-publish-card"><h2>Publishing status</h2><div className="cms-publish-state"><span className="cms-studio-dot" /><StatusBadge status={record?.status || 'draft'} /></div><p>Public visibility is controlled by the last successful publish. Preview content stays in this editor.</p><div className="cms-editor-meta"><span>Last saved</span><strong>{datePretty(record?.updatedAt?.seconds ? new Date(record.updatedAt.seconds * 1000).toISOString().slice(0, 10) : '')}</strong></div><div className="cms-editor-meta"><span>Published revision</span><strong>{record?.publishedRevision ?? 0}</strong></div></section><section className="cms-editor-card"><h2>Cover canvas</h2>{heroPreviewUrl || form.heroImage.url ? <img className="cms-aside-image" src={heroPreviewUrl || form.heroImage.url} alt={form.heroImage.caption || ''} /> : <div className="cms-cover-placeholder"><ImageIcon size={22} /><span>Upload a project hero</span></div>}<Button className="cms-action-preview" disabled={!ready || mutation.busy} onClick={() => { setUploadPlacement('aside'); heroImageInput.current?.click() }}><Upload size={14} /> {mutation.busy ? 'Uploading…' : heroPreviewUrl || form.heroImage.url ? 'Replace Cover Canvas' : 'Upload Cover Canvas'}</Button>{progress > 0 && uploadPlacement === 'aside' && <div className="cms-upload-status" role="status"><progress className="cms-upload-progress" max="100" value={progress} /><span>Uploading Cover Canvas · {progress}%</span></div>}<p className="cms-muted">JPEG, PNG, or WebP · maximum 12 MB. Saved to the project when you save this form.</p></section>{preview && <section className="cms-editor-card cms-draft-preview"><p className="cms-eyebrow">PRIVATE DRAFT PREVIEW</p><h2>{form.title || 'Untitled project'}</h2><p>{form.synopsis}</p>{(heroPreviewUrl || form.heroImage.url) && <img src={heroPreviewUrl || form.heroImage.url} alt={form.heroImage.caption || ''} />}{form.executiveSummary && <div><strong>Executive summary</strong><MarkdownContent source={form.executiveSummary} /></div>}{form.techStack.length > 0 && <div className="cms-tag-list">{form.techStack.map((item) => <span key={item}>{item}</span>)}</div>}</section>}</aside></div>
  </>
}

export function CmsBackgroundPage() {
  const [kind, setKind] = useState('experiences')
  const recordsState = useCmsCollection(kind)
  const mutation = useMutation()
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(EMPTY_EXPERIENCE)
  const [previewId, setPreviewId] = useState('')
  const [editorPreview, setEditorPreview] = useState(false)
  const [assetCleanupWarning, setAssetCleanupWarning] = useState('')
  const [uploadingAsset, setUploadingAsset] = useState(false)
  const uploadedAssetPaths = useRef(new Set())
  const apiStatus = useCmsApiStatus()
  const ready = apiStatus.ready
  const records = useMemo(() => {
    const all = new Map(recordsState.drafts.map((item) => [item.id, item]))
    for (const item of recordsState.published) if (!all.has(item.id)) all.set(item.id, item)
    return [...all.values()].filter((item) => item.status !== 'deleted').sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
  }, [recordsState.drafts, recordsState.published])
  const start = (item = null, targetKind = kind) => {
    setKind(targetKind)
    const empty = targetKind === 'experiences' ? EMPTY_EXPERIENCE : EMPTY_EDUCATION
    setSelected(item || { isNew: true })
    const existing = item ? cleanRecord(item) : {}
    const isKnownDegree = EDUCATION_DEGREES.includes(existing.degree)
    setForm(item
      ? {
        ...empty,
        ...existing,
        ...(targetKind === 'experiences' ? {
          skills: normalizeSkills(existing.skills),
        } : {}),
        ...(targetKind === 'education' ? {
          degree: isKnownDegree ? existing.degree : 'Other',
          customDegree: existing.customDegree || (isKnownDegree ? '' : existing.degree || ''),
          credentialImage: existing.credentialImage || null,
        } : {
          recommendationLetter: existing.recommendationLetter || null,
          recommendationLetterUrl: existing.recommendationLetterUrl || '',
        }),
      }
      : { ...empty, order: targetKind === kind ? records.length : 0 })
    setEditorPreview(false)
    setAssetCleanupWarning('')
    uploadedAssetPaths.current.clear()
    mutation.clear()
  }
  const closeEditor = async () => {
    if (mutation.busy) return
    const paths = [...uploadedAssetPaths.current]
    if (paths.length) {
      const discarded = await mutation.run(
        () => adminApi.discardUnreferencedPrivateAssets(paths),
        'Uncommitted document uploads removed.',
      )
      if (!discarded) return
    }
    setSelected(null)
    setForm(kind === 'experiences' ? EMPTY_EXPERIENCE : EMPTY_EDUCATION)
    setEditorPreview(false)
    uploadedAssetPaths.current.clear()
    mutation.clear()
  }
  const uploadBackgroundImage = async (field, file) => {
    if (!file) return
    setUploadingAsset(true)
    try {
      const asset = await mutation.run(
        () => adminApi.uploadPrivateAsset(file),
        'Document image uploaded to private storage.',
      )
      if (!asset) return
      uploadedAssetPaths.current.add(asset.storagePath)
      setForm((current) => ({ ...current, [field]: asset }))
    } finally {
      setUploadingAsset(false)
    }
  }
  const save = async (publishAfterSave = false) => {
    const schema = kind === 'experiences' ? experienceSchema : educationSchema
    let content
    try { content = schema.parse({ ...form, order: Number(form.order), ...(kind === 'education' ? { startYear: Number(form.startYear), endYear: form.endYear === '' || form.endYear == null ? null : Number(form.endYear) } : {}) }) }
    catch (error) { mutation.clear(); return mutation.run(() => { throw new Error(error.issues?.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' · ') || error.message) }) }
    if (!isLocalCmsMode()) {
      for (const field of ['credentialImage', 'recommendationLetter']) {
        if (content[field]?.storagePath) content[field] = { ...content[field], url: '' }
      }
    }
    if (publishAfterSave) {
      const degreeTitle = form.degree === 'Other' ? form.customDegree : form.degree
      const title = kind === 'experiences' ? `${form.role} at ${form.company}` : `${degreeTitle} · ${form.institution}`
      if (!window.confirm(`Review background publish\n\n${title}\n${kind === 'experiences' ? form.description : form.notes}\n\nSave and publish this ${kind === 'experiences' ? 'experience' : 'education'} entry?`)) return
    }
    let savedDraft = null
    const result = await mutation.run(async () => {
      savedDraft = selected?.id
        ? await adminApi.save(kind, selected.id, content, selected.revision)
        : await adminApi.create(kind, content)
      return publishAfterSave
        ? adminApi.publish(kind, savedDraft.id, savedDraft.revision)
        : savedDraft
    }, publishAfterSave ? 'Background entry saved and published.' : 'Background draft saved.')
    const savedPaths = new Set(backgroundAssetPaths(savedDraft || form))
    const noLongerReferenced = [
      ...backgroundAssetPaths(selected?.id ? cleanRecord(selected) : {}),
      ...uploadedAssetPaths.current,
    ].filter((path) => path.startsWith('portfolio-private/') && !savedPaths.has(path))
    if (noLongerReferenced.length) {
      try {
        await adminApi.discardUnreferencedPrivateAssets(noLongerReferenced)
        noLongerReferenced.forEach((path) => uploadedAssetPaths.current.delete(path))
        setAssetCleanupWarning('')
      } catch (error) {
        setAssetCleanupWarning(`Saved content is intact, but an unused private upload could not be cleaned up: ${error.message}`)
      }
    }
    if (savedDraft) {
      uploadedAssetPaths.current.clear()
    }
    if (savedDraft) {
      let current = { ...savedDraft, ...(result || {}) }
      try {
        const view = publishAfterSave && result ? 'published' : 'drafts'
        current = await adminApi.get(kind, savedDraft.id, view) || current
      } catch { /* Retain the successful draft-save result if the refresh fails. */ }
      setSelected(current)
      recordsState.refresh()
    }
  }
  const publishRecord = async (item) => {
    const title = kind === 'experiences' ? `${item.role} at ${item.company}` : `${item.degree} · ${item.institution}`
    if (!window.confirm(`Review background publish\n\n${title}\n${kind === 'experiences' ? item.description : item.notes}\n\nPublish this selected entry?`)) return
    const result = await mutation.run(() => adminApi.publish(kind, item.id, item.revision), 'Background entry published.')
    if (result) recordsState.refresh()
  }
  const unpublish = async (item) => {
    if (!window.confirm('Unpublish this background entry? Its saved history will be kept.')) return
    const result = await mutation.run(() => adminApi.unpublish(kind, item.id), 'Background entry unpublished.')
    if (result) recordsState.refresh()
  }
  const deleteBackground = async (item) => {
    if (!window.confirm(`Delete “${titleOf(item)}”? It will be removed from the public portfolio, with its history kept.`)) return
    const result = await mutation.run(() => adminApi.deleteItem(kind, item.id), 'Background entry deleted and its history retained.')
    if (result) recordsState.refresh()
  }
  const reorder = async (record, delta) => {
    const currentIndex = records.findIndex((item) => item.id === record.id)
    const targetIndex = currentIndex + delta
    if (targetIndex < 0 || targetIndex >= records.length) return
    const moved = [...records]
    ;[moved[currentIndex], moved[targetIndex]] = [moved[targetIndex], moved[currentIndex]]
    const result = await mutation.run(() => adminApi.reorder(kind, moved.map((item, order) => ({ id: item.id, expectedRevision: item.revision, order }))), 'Display order saved as a private draft.')
    if (result) recordsState.refresh()
  }
  const edit = Boolean(selected?.id)
  const titleOf = (item) => kind === 'experiences' ? item.role : item.degree === 'Other' ? item.customDegree || 'Other' : item.degree
  const previewTitle = kind === 'experiences' ? form.role : form.degree === 'Other' ? form.customDegree : form.degree
  const previewSubtitle = kind === 'experiences' ? form.company : form.institution
  const previewDescription = kind === 'experiences' ? form.description : form.notes
  return <><PageHeader eyebrow="EDITORIAL BIOGRAPHY" title="Background & Credentials" description="Manage professional experience, education, dates, skills, visibility, and portfolio sequence." actions={<><Button variant="brown" onClick={() => start(null, 'experiences')}><Plus size={15} /> Add Experience</Button><Button onClick={() => start(null, 'education')}><Plus size={15} /> Add Education</Button></>} />
    {!ready && <CmsConnectionNotice status={apiStatus} />}{recordsState.error && <ContentError error={recordsState.error} retry={recordsState.refresh} />}{mutation.error && <Notice kind="error">{mutation.error}</Notice>}{assetCleanupWarning && <Notice kind="warning">{assetCleanupWarning}</Notice>}{mutation.success && <Notice kind="success">{mutation.success}</Notice>}
    <section className="cms-stats-grid cms-background-stats"><StatCard icon={FolderKanban} label="TOTAL MILESTONES" value={records.length} detail={`${records.filter((item) => item.status === 'published').length} live on portfolio`} badge="Records" tone="green" /><StatCard icon={GraduationCap} label="CAREER & ACADEMICS" value={kind === 'experiences' ? 'Experience' : 'Education'} detail={`${records.length} entries in this section`} badge="Selected view" tone="neutral" /><StatCard icon={FileText} label="PENDING REVIEW" value={records.filter((item) => item.status === 'draft').length} detail="Draft entries awaiting publish" badge="Private drafts" tone="amber" /><StatCard icon={ShieldCheck} label="PUBLIC VISIBILITY" value={records.filter((item) => item.visibility && item.status === 'published').length} detail="Published and set to visible" badge="Live items" tone="green" /></section>
    <div className="cms-tabs" role="tablist"><button role="tab" aria-selected={kind === 'experiences'} className={kind === 'experiences' ? 'is-active' : ''} onClick={() => { setKind('experiences'); setSelected(null) }}><FolderKanban size={15} /> Work Experience <span>{recordsState.drafts.length}</span></button><button role="tab" aria-selected={kind === 'education'} className={kind === 'education' ? 'is-active' : ''} onClick={() => { setKind('education'); setSelected(null) }}><GraduationCap size={15} /> Education & Degrees</button></div>
    {recordsState.loading ? <LoadingPanel /> : records.length ? <div className="cms-background-list">{records.map((item, index) => <article key={item.id} className={`cms-background-card${item.status === 'draft' ? ' is-draft' : ''}`}><div className="cms-drag-handle" aria-hidden="true">⠿</div><div className="cms-background-monogram">{kind === 'experiences' ? item.logoInitials || item.company?.slice(0, 2) : item.institution?.slice(0, 2)}</div><div className="cms-background-copy"><div className="cms-background-title"><h2>{titleOf(item)}</h2><span>•</span><strong>{kind === 'experiences' ? item.company : item.institution}</strong>{kind === 'experiences' && item.isCurrent && <span className="cms-badge cms-badge-green">Current role</span>}<StatusBadge status={item.status} /></div><p className="cms-background-meta">{kind === 'experiences' ? `${dateValue(item.startDate)} — ${item.isCurrent ? 'Present' : dateValue(item.endDate)} · ${item.location} · ${item.employmentType}` : `${item.startYear}${item.endYear ? ` — ${item.endYear}` : ''}`}</p><p>{kind === 'experiences' ? item.description : item.notes}</p>{item.skills?.length > 0 && <div className="cms-tag-list">{item.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>}</div><div className="cms-record-controls"><Button className="cms-square-button" title="Move earlier" disabled={!ready || index === 0 || mutation.busy} onClick={() => reorder(item, -1)}><ArrowUp size={14} /></Button><Button className="cms-square-button" title="Move later" disabled={!ready || index === records.length - 1 || mutation.busy} onClick={() => reorder(item, 1)}><ArrowDown size={14} /></Button><Button className="cms-action-preview" onClick={() => setPreviewId((current) => current === item.id ? '' : item.id)}><Eye size={13} /> {previewId === item.id ? 'Hide preview' : 'Preview'}</Button><Button className="cms-action-edit" onClick={() => start(item)}>Edit</Button>{item.status === 'published' ? <Button className="cms-action-unpublish" onClick={() => unpublish(item)} disabled={!ready || mutation.busy}>Unpublish</Button> : <Button className="cms-action-publish" variant="brown" onClick={() => publishRecord(item)} disabled={!ready || mutation.busy}>Publish</Button>}<Button className="cms-square-button cms-action-delete" title="Delete and retain history" disabled={!ready || mutation.busy} onClick={() => deleteBackground(item)}><Trash2 size={14} /></Button></div>{previewId === item.id && <div className="cms-record-preview"><p className="cms-eyebrow">PRIVATE PREVIEW · {kind === 'experiences' ? 'EXPERIENCE' : 'EDUCATION'}</p><h3>{titleOf(item)}</h3><strong>{kind === 'experiences' ? item.company : item.institution}</strong><p>{kind === 'experiences' ? item.description : item.notes}</p>{item.skills?.length > 0 && <div className="cms-tag-list">{item.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>}</div>}</article>)}</div> : <EmptyState title="No background entries yet" text="Add your work history and education, then publish each item to the portfolio." />}
    {selected !== null && <div className="cms-modal-backdrop" role="presentation" onMouseDown={(event) => { if (!mutation.busy && event.target === event.currentTarget) closeEditor() }}>
      <form className="cms-modal" onSubmit={(event) => { event.preventDefault(); save() }}>
        <div className="cms-panel-heading">
          <div><p className="cms-eyebrow">{kind === 'experiences' ? 'WORK EXPERIENCE' : 'EDUCATION'}</p><h2>{edit ? 'Edit entry' : `Add ${kind === 'experiences' ? 'experience' : 'education'}`}</h2></div>
          <button type="button" className="cms-icon-button" onClick={closeEditor} aria-label="Close editor" disabled={mutation.busy}>×</button>
        </div>
        {kind === 'experiences' ? <>
          <div className="cms-field-grid">
            <TextInput label="Role title *" value={form.role} onChange={(value) => setForm({ ...form, role: value })} required />
            <TextInput label="Company *" value={form.company} onChange={(value) => setForm({ ...form, company: value })} required />
            <TextInput label="Start date *" type="date" value={form.startDate} onChange={(value) => setForm({ ...form, startDate: value })} required />
            <TextInput label="End date" type="date" value={form.endDate} onChange={(value) => setForm({ ...form, endDate: value })} disabled={form.isCurrent} />
            <TextInput label="Location" value={form.location} onChange={(value) => setForm({ ...form, location: value })} />
            <TextInput label="Employment type" value={form.employmentType} onChange={(value) => setForm({ ...form, employmentType: value })} />
            <TextInput label="Initials" value={form.logoInitials} onChange={(value) => setForm({ ...form, logoInitials: value })} maxLength={8} />
            <TextInput label="Display order" type="number" value={form.order} onChange={(value) => setForm({ ...form, order: Number(value) })} />
          </div>
          <label className="cms-checkbox-field"><input type="checkbox" checked={form.isCurrent} onChange={(event) => setForm({ ...form, isCurrent: event.target.checked, endDate: '' })} /> This is my current position</label>
          <TextArea label="Description" value={form.description} onChange={(value) => setForm({ ...form, description: value })} rows={4} />
          <SkillTagInput values={form.skills} onChange={(value) => setForm((current) => ({ ...current, skills: value }))} disabled={mutation.busy} />
          <section className="cms-background-documents">
            <div className="cms-section-heading"><span className="cms-step-number">04</span><div><h2>Recommendation Letter</h2><p>Attach a private image, an external link, or both. Neither is required.</p></div></div>
            <BackgroundImageUpload title="Recommendation letter image" description="Upload a photograph or scan of the recommendation letter." asset={form.recommendationLetter} busy={mutation.busy} uploading={uploadingAsset} onUpload={(file) => uploadBackgroundImage('recommendationLetter', file)} onRemove={() => setForm((current) => ({ ...current, recommendationLetter: null }))} />
            <TextInput label="Recommendation letter URL" type="url" value={form.recommendationLetterUrl} onChange={(value) => setForm((current) => ({ ...current, recommendationLetterUrl: value }))} placeholder="https://…" />
          </section>
        </> : <>
          <div className="cms-field-grid">
            <Field label="Degree or credential *"><select value={form.degree} onChange={(event) => setForm((current) => ({ ...current, degree: event.target.value, customDegree: event.target.value === 'Other' ? current.customDegree : '' }))} required><option value="">Choose a qualification</option>{EDUCATION_DEGREES.map((degree) => <option key={degree} value={degree}>{degree}</option>)}</select></Field>
            {form.degree === 'Other' && <TextInput label="Custom qualification *" value={form.customDegree} onChange={(value) => setForm((current) => ({ ...current, customDegree: value }))} required maxLength={160} />}
            <TextInput label="Institution *" value={form.institution} onChange={(value) => setForm({ ...form, institution: value })} required />
            <TextInput label="Start year *" type="number" value={form.startYear} onChange={(value) => setForm({ ...form, startYear: value })} required />
            <TextInput label="End year" type="number" value={form.endYear ?? ''} onChange={(value) => setForm({ ...form, endYear: value })} placeholder="Leave blank if current" />
            <TextInput label="Display order" type="number" value={form.order} onChange={(value) => setForm({ ...form, order: Number(value) })} />
          </div>
          <TextArea label="Notes" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} rows={3} />
          <section className="cms-background-documents">
            <div className="cms-section-heading"><span className="cms-step-number">04</span><div><h2>Degree or Credential Documents</h2><p>Attach a private certificate image, an external credential link, or both. Neither is required.</p></div></div>
            <BackgroundImageUpload title="Credential image" description="Upload a photograph or scan of the certificate or diploma." asset={form.credentialImage} busy={mutation.busy} uploading={uploadingAsset} onUpload={(file) => uploadBackgroundImage('credentialImage', file)} onRemove={() => setForm((current) => ({ ...current, credentialImage: null }))} />
            <TextInput label="Credential Link" type="url" value={form.credentialUrl} onChange={(value) => setForm((current) => ({ ...current, credentialUrl: value }))} placeholder="https://…" />
          </section>
        </>}
        <label className="cms-checkbox-field"><input type="checkbox" checked={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.checked })} /> Visible after publishing</label>
        {editorPreview && <section className="cms-record-preview" aria-label="Private draft preview">
          <p className="cms-eyebrow">PRIVATE DRAFT PREVIEW · NOT PUBLISHED</p>
          <h3>{previewTitle || 'Untitled entry'}</h3>
          <strong>{previewSubtitle || 'Organization not specified'}</strong>
          <p>{kind === 'experiences' ? `${dateValue(form.startDate) || 'Start date'} — ${form.isCurrent ? 'Present' : dateValue(form.endDate) || 'End date'}${form.location ? ` · ${form.location}` : ''}` : `${form.startYear || 'Start year'}${form.endYear ? ` — ${form.endYear}` : ''}`}</p>
          <p>{previewDescription || 'No description provided.'}</p>
          {kind === 'experiences' && form.skills?.length > 0 && <div className="cms-tag-list">{form.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>}
          {kind === 'education' && (form.credentialUrl || form.credentialImage?.url) && <div className="cms-background-document-links">{form.credentialImage?.url && <a href={form.credentialImage.url} target="_blank" rel="noopener noreferrer">View Certificate</a>}{form.credentialUrl && <a href={form.credentialUrl} target="_blank" rel="noopener noreferrer">View Credential</a>}</div>}
          {kind === 'experiences' && (form.recommendationLetter?.url || form.recommendationLetterUrl) && <div className="cms-background-document-links">{form.recommendationLetter?.url && <a href={form.recommendationLetter.url} target="_blank" rel="noopener noreferrer">View Recommendation Letter</a>}{form.recommendationLetterUrl && <a href={form.recommendationLetterUrl} target="_blank" rel="noopener noreferrer">Recommendation Letter Link</a>}</div>}
        </section>}
        <div className="cms-modal-actions">
          <Button onClick={closeEditor} disabled={mutation.busy}>Cancel</Button>
          <Button onClick={() => setEditorPreview((value) => !value)} disabled={mutation.busy}><Eye size={14} /> {editorPreview ? 'Hide draft preview' : 'Preview draft'}</Button>
          <Button type="submit" variant="primary" disabled={!ready || mutation.busy}><Save size={14} /> Save draft</Button>
          <Button variant="brown" disabled={!ready || mutation.busy} onClick={() => save(true)}><CloudUpload size={14} /> Save & publish</Button>
        </div>
      </form>
    </div>}
  </>
}

export function CmsResumePage() {
  const { drafts, published, loading, error, refresh } = useCmsCollection('resumes')
  const mutation = useMutation()
  const [progress, setProgress] = useState(0)
  const [previewId, setPreviewId] = useState('')
  const apiStatus = useCmsApiStatus()
  const ready = apiStatus.ready
  const localMode = apiStatus.state === 'local'
  const versions = useMemo(() => {
    const map = new Map([...published, ...drafts].map((item) => [item.id, item]))
    return [...map.values()].filter((item) => item.status !== 'deleted').sort((a, b) => Number(b.order || 0) - Number(a.order || 0))
  }, [drafts, published])
  const active = published.find((item) => item.status === 'published' && item.visibility && item.isActive)
  const preview = versions.find((item) => item.id === previewId) || active || versions.find((item) => item.status === 'draft') || null
  const upload = async (file) => {
    if (!file) return
    if (!localMode && apiStatus.storageReady === false) {
      await mutation.run(() => { throw new Error(apiStatus.storageMessage || 'Supabase Storage is unavailable. Check portfolio-published and portfolio-private, plus the separate legacy IDs "portfolio_media", "portfolio-media", and "portfolio-media.".') })
      return
    }
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) { mutation.run(() => { throw new Error('Choose a PDF larger than 0 bytes and no larger than 5 MB.') }); return }
    setProgress(1)
    const result = await mutation.run(() => adminApi.upload(file, { kind: 'resume', onProgress: setProgress }), localMode ? 'Resume saved to local disk as a private draft.' : 'Resume uploaded as a private draft.')
    setProgress(0)
    if (result) { setPreviewId(result.id); refresh() }
  }
  const publish = async (item) => {
    if (!window.confirm(`Review resume publish\n\n${item.fileName}\nVersion ${item.version} · ${item.sizeKB} KB\n\n${localMode ? 'This updates only the local public preview on this device.' : 'This will make it the single active resume on the public website.'} Continue?`)) return
    const result = await mutation.run(() => adminApi.publish('resumes', item.id, item.revision), localMode ? `Resume v${item.version} is active in the local preview.` : `Resume v${item.version} is now active on the website.`)
    if (result) refresh()
  }
  const unpublish = async (item) => {
    if (!window.confirm(localMode ? 'Hide the active resume from this local preview?' : 'Hide the active resume from the public website?')) return
    const result = await mutation.run(() => adminApi.unpublish('resumes', item.id), localMode ? 'Resume is hidden from the local preview.' : 'Resume is hidden from the public site.')
    if (result) refresh()
  }
  const remove = async (item) => {
    if (!window.confirm(`Delete ${item.fileName || 'this resume'}?${item.isActive ? ' It will also disappear from the public portfolio.' : ''}`)) return
    const result = await mutation.run(() => adminApi.deleteItem('resumes', item.id), localMode ? 'Resume removed from local storage.' : 'Resume version deleted.')
    if (result) { if (previewId === item.id) setPreviewId(''); refresh() }
  }
  return <><PageHeader eyebrow="PORTFOLIO ASSETS & DOCUMENT REGISTRY" title="Resume Management" description={localMode ? 'Upload a PDF to local disk, preview it, and activate the local public download. Nothing is sent to the live website.' : 'Upload PDF versions, preview and download them, then activate one version for the public website.'} actions={<label className="cms-button cms-button-brown cms-file-button"><Upload size={15} /> Upload new resume PDF<input type="file" accept="application/pdf,.pdf" disabled={!ready || mutation.busy} onChange={(event) => upload(event.target.files?.[0])} /></label>} />
    {!ready && <CmsConnectionNotice status={apiStatus} />}{error && <ContentError error={error} retry={refresh} />}{mutation.error && <Notice kind="error">{mutation.error}</Notice>}{mutation.success && <Notice kind="success">{mutation.success}</Notice>}<progress className="cms-upload-progress" max="100" value={progress} hidden={!progress} />
    <div className="cms-sync-banner"><span className="cms-stat-icon"><ShieldCheck size={18} /></span><div><strong>{localMode ? 'Local filesystem storage' : 'Live integration sync'}</strong><p>{localMode ? 'The PDF is saved under .local-cms/uploads on this machine. Activating a version updates only the local public preview.' : 'Only the published active resume is linked from the public website. Previous versions remain stored for rollback.'}</p></div><span className="cms-badge cms-badge-green">{active ? `${localMode ? 'Local active' : 'Active'} v${active.version}` : 'No active version'}</span></div>
    <div className="cms-resume-layout"><div className="cms-resume-column"><section className="cms-editor-card cms-active-resume"><div className="cms-panel-heading"><div><p className="cms-eyebrow">ACTIVE PORTFOLIO FILE</p><h2>{active?.fileName || 'No resume published'}</h2></div>{active && <span className="cms-badge cms-badge-green">{localMode ? 'Published · Local preview' : 'Published · Live'}</span>}</div>{active ? <><div className="cms-resume-facts"><span><small>Format</small><strong>PDF</strong></span><span><small>File size</small><strong>{active.sizeKB} KB</strong></span><span><small>Version</small><strong>v{active.version}</strong></span></div><div className="cms-resume-actions"><Button href={active.previewUrl || active.fileUrl} target="_blank"><Eye size={14} /> Preview PDF</Button><Button href={active.fileUrl} download="Fitsum-Mesfin-Resume.pdf"><ArrowDown size={14} /> Download PDF</Button><Button disabled={!ready || mutation.busy} onClick={() => unpublish(active)}>Hide from website</Button></div></> : <EmptyState title="No active resume" text="Upload a PDF draft and publish it to connect the public download link." />}</section>
      <section className="cms-editor-card"><div className="cms-panel-heading"><div><h2>Upload & version update</h2><p>PDF documents only, maximum 5 MB. The file content is checked before it is accepted.</p></div><CloudUpload size={18} /></div><label className="cms-pdf-drop"><Upload size={22} /><strong>Choose a resume PDF to upload</strong><span>Click to browse local files · PDF only · max 5 MB</span><input type="file" accept="application/pdf,.pdf" disabled={!ready || mutation.busy} onChange={(event) => upload(event.target.files?.[0])} /></label><div className="cms-validation-list"><span><Check size={14} /> PDF structure and cross-reference checked</span><span><Check size={14} /> 5 MB payload limit checked</span><span><Check size={14} /> New version remains a private draft until publish</span></div></section>
    <section className="cms-editor-card"><div className="cms-panel-heading"><div><h2>Version history</h2><p>{versions.length} stored versions</p></div></div>{loading ? <LoadingPanel /> : versions.length ? <div className="cms-version-list">{versions.map((item) => <article className="cms-version-row" key={item.id}><span className={`cms-version-marker${item.isActive && item.status === 'published' ? ' is-active' : ''}`}>{item.version}</span><div><div className="cms-version-heading"><strong>Version {item.version} · {item.fileName}</strong><StatusBadge status={item.status} />{item.isActive && item.status === 'published' && <span className="cms-badge cms-badge-green">Active</span>}</div><small>{item.sizeKB} KB · {item.notes || 'PDF version'}</small><div className="cms-version-actions"><button type="button" onClick={() => setPreviewId(item.id)}>Preview in viewer</button><a href={item.fileUrl || undefined} download={item.fileName}>Download PDF</a>{item.status !== 'published' || !item.isActive ? <button type="button" disabled={!ready || mutation.busy || item.status === 'unpublished'} onClick={() => publish(item)}>{item.status === 'published' ? 'Restore this version' : 'Publish version'}</button> : <span>Currently active</span>}<button type="button" disabled={!ready || mutation.busy} onClick={() => remove(item)}>Delete</button></div></div></article>)}</div> : <EmptyState title="No resume versions yet" text="Your first upload will start the version history." />}</section></div><aside className="cms-resume-preview"><div className="cms-pdf-toolbar"><span>{preview ? `PDF preview · ${preview.fileName}` : 'PDF preview'}</span><span>{preview ? `Version ${preview.version} · ${preview.status}` : 'No document'}</span></div>{(preview?.previewUrl || preview?.fileUrl) ? <iframe src={`${preview.previewUrl || preview.fileUrl}#toolbar=0&navpanes=0`} title={`Resume PDF preview: ${preview.fileName}`} /> : <div className="cms-pdf-preview-empty"><FileText size={34} /><p>{preview ? 'This resume file is unavailable in local storage. Upload it again to preview it.' : 'Upload a resume PDF to inspect it here before publishing.'}</p></div>}</aside></div>
  </>
}

export function CmsMediaPage() {
  const { drafts, published, loading, error, refresh } = useCmsCollection('media')
  const mutation = useMutation()
  const [query, setQuery] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [alt, setAlt] = useState('')
  const [progress, setProgress] = useState(0)
  const apiStatus = useCmsApiStatus()
  const ready = apiStatus.ready
  const localMode = apiStatus.state === 'local'
  const items = useMemo(() => [...new Map([...published, ...drafts].map((item) => [item.id, item])).values()].filter((item) => ['draft', 'published'].includes(item.status)).filter((item) => `${item.fileName} ${item.alt} ${item.sourceUrl}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(b.order || 0) - Number(a.order || 0)), [drafts, published, query])
  const upload = async (file) => {
    if (!file) return
    if (!localMode && apiStatus.storageReady === false) {
      await mutation.run(() => { throw new Error(apiStatus.storageMessage || 'Supabase Storage is unavailable. Check portfolio-published and portfolio-private, plus the separate legacy IDs "portfolio_media", "portfolio-media", and "portfolio-media.".') })
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 12 * 1024 * 1024) {
      await mutation.run(() => { throw new Error('Choose a JPEG, PNG, or WebP image larger than 0 bytes and no larger than 12 MB.') })
      return
    }
    setProgress(1)
    const item = await mutation.run(() => adminApi.upload(file, { kind: 'image', alt, onProgress: setProgress }), localMode ? 'Image saved to local disk.' : 'Image saved as a private draft. Publish it explicitly after reviewing.')
    setProgress(0)
    if (item) { setAlt(''); refresh() }
  }
  const replace = async (current, file) => {
    if (!file) return
    if (!localMode && apiStatus.storageReady === false) {
      await mutation.run(() => { throw new Error(apiStatus.storageMessage || 'Supabase Storage is unavailable. Check portfolio-published and portfolio-private, plus the separate legacy IDs "portfolio_media", "portfolio-media", and "portfolio-media.".') })
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 12 * 1024 * 1024) {
      await mutation.run(() => { throw new Error('Choose a JPEG, PNG, or WebP image larger than 0 bytes and no larger than 12 MB.') })
      return
    }
    setProgress(1)
    const item = await mutation.run(() => adminApi.upload(file, { kind: 'image', alt: current.alt, replaceMediaId: current.id, onProgress: setProgress }), localMode ? 'Image replaced on local disk.' : 'Replacement saved as a private draft. Publish it explicitly after reviewing.')
    setProgress(0)
    if (item) refresh()
  }
  const importUrl = async (event) => {
    event.preventDefault()
    if (!localMode && apiStatus.storageReady === false) {
      await mutation.run(() => { throw new Error(apiStatus.storageMessage || 'Supabase Storage is unavailable. Check portfolio-published and portfolio-private, plus the separate legacy IDs "portfolio_media", "portfolio-media", and "portfolio-media.".') })
      return
    }
    const item = await mutation.run(() => adminApi.importImage(sourceUrl.trim(), alt), localMode ? 'Image URL added to the local media library.' : 'Image imported as a private draft. Publish it explicitly after reviewing.')
    if (item) { setSourceUrl(''); setAlt(''); refresh() }
  }
  const remove = async (item) => { if (!window.confirm(`Delete ${item.fileName || 'this image'} from ${localMode ? 'this machine' : 'managed storage'}?`)) return; const result = await mutation.run(() => adminApi.removeMedia(item.id), 'Unused media asset deleted.'); if (result) refresh() }
  const publish = async (item) => {
    const result = await mutation.run(
      () => adminApi.publish('media', item.id, item.revision),
      'Media published. Review public Storage again if this copied or changed an object.',
    )
    if (result) {
      refresh()
      if (!localMode) await checkCmsApiHealth()
    }
  }
  const unpublish = async (item) => {
    const result = await mutation.run(
      () => adminApi.unpublish('media', item.id),
      'Media unpublished.',
    )
    if (result) {
      refresh()
      if (!localMode) await checkCmsApiHealth()
    }
  }
  const copy = async (value) => { try { await navigator.clipboard.writeText(value); mutation.run(async () => true, 'Managed URL copied.') } catch { mutation.run(() => { throw new Error('Clipboard access is not available in this browser.') }) } }
  return <><PageHeader eyebrow={localMode ? 'LOCAL DISK ASSETS' : 'PORTFOLIO ASSETS · MANAGED STORAGE'} title="Media Library" description={localMode ? 'Upload image files to local disk or add a reference to an existing public image URL.' : 'New images are private drafts. Publish assets explicitly after review; changes to public Storage require a new trusted-operator review.'} actions={<label className="cms-button cms-button-brown cms-file-button"><Upload size={15} /> Upload image<input type="file" accept="image/jpeg,image/png,image/webp" disabled={!ready || mutation.busy} onChange={(event) => upload(event.target.files?.[0])} /></label>} />
    {!ready && <CmsConnectionNotice status={apiStatus} />}{error && <ContentError error={error} retry={refresh} />}{mutation.error && <Notice kind="error">{mutation.error}</Notice>}{mutation.success && <Notice kind="success">{mutation.success}</Notice>}<progress className="cms-upload-progress" max="100" value={progress} hidden={!progress} />
    <section className="cms-editor-card cms-import-card"><div><h2>{localMode ? 'Reference a public image URL' : 'Import from a permitted image URL'}</h2><p>{localMode ? 'This saves the image URL in the local library. Upload a file to keep its image bytes on local disk.' : 'The trusted backend validates each redirect and rejects private network destinations before it copies the bytes.'}</p></div><form onSubmit={importUrl} className="cms-inline-import"><TextInput label="Image URL" type="url" value={sourceUrl} onChange={setSourceUrl} placeholder="https://example.com/image.webp" required /><TextInput label="Alt text" value={alt} onChange={setAlt} maxLength={300} placeholder="Describe the image" /><Button type="submit" variant="primary" disabled={!ready || mutation.busy}><CloudUpload size={14} /> {localMode ? 'Save URL' : 'Import image'}</Button></form><small>Import only images you have permission to use. JPEG, PNG, WebP · max 12 MB.</small></section>
    <div className="cms-toolbar"><span className="cms-quiet-label">{items.length} managed assets</span><label className="cms-search cms-toolbar-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search filename, alt text…" aria-label="Search media" /></label></div>
    {loading ? <LoadingPanel /> : items.length ? <div className="cms-media-grid">{items.map((item) => <article key={item.id} className="cms-media-card"><div className="cms-media-image">{item.type === 'image' ? <img src={item.url} alt={item.alt || item.fileName || ''} loading="lazy" /> : <FileText size={32} />}</div><div className="cms-media-details"><strong title={item.fileName}>{item.fileName || 'Managed image'}</strong><StatusBadge status={item.status} /><small>{item.width && item.height ? `${item.width} × ${item.height} · ` : ''}{(item.sizeBytes / 1024).toFixed(0)} KB</small><div className="cms-tag-list"><span>{item.mimeType || item.type}</span><span>{item.status === 'published' ? 'Public' : 'Private draft'}</span></div>{item.sourceUrl && <small className="cms-media-source">Source: <a href={item.sourceUrl} target="_blank" rel="noreferrer">{new URL(item.sourceUrl).hostname}</a></small>}<small className="cms-media-usage">{item.usedIn?.length ? `Used in ${item.usedIn.length}: ${item.usedIn.slice(0, 2).join(', ')}${item.usedIn.length > 2 ? '…' : ''}` : 'Not referenced by saved content'}</small><div className="cms-media-actions"><Button onClick={() => copy(item.url)}>Copy URL</Button><label className="cms-button cms-file-button" title="Save a private replacement draft">Replace<input type="file" accept="image/jpeg,image/png,image/webp" disabled={!ready || mutation.busy} onChange={(event) => replace(item, event.target.files?.[0])} /></label>{item.status === 'published' ? <Button disabled={!ready || mutation.busy} onClick={() => unpublish(item)}>Unpublish</Button> : <Button variant="brown" disabled={!ready || mutation.busy} onClick={() => publish(item)}>Publish</Button>}<Button disabled={!ready || mutation.busy || Boolean(item.usedIn?.length)} title={item.usedIn?.length ? 'Remove references before deleting this file' : 'Delete unused file'} onClick={() => remove(item)}><Trash2 size={14} /></Button></div></div></article>)}</div> : <EmptyState title="No managed assets found" text="Upload an image or import a permitted image URL. New uploads remain private drafts until explicitly published." action={<label className="cms-button cms-button-primary cms-file-button"><Upload size={14} /> Choose image<input type="file" accept="image/jpeg,image/png,image/webp" disabled={!ready || mutation.busy} onChange={(event) => upload(event.target.files?.[0])} /></label>} />}
  </>
}

export function CmsSettingsPage() {
  const mutation = useMutation()
  const [record, setRecord] = useState(null)
  const [form, setForm] = useState(EMPTY_SETTINGS)
  const [projectOptions, setProjectOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const apiStatus = useCmsApiStatus()
  const ready = apiStatus.ready
  const load = useCallback(async () => {
    if (!ready) {
      setLoading(apiStatus.checking)
      setError('')
      return
    }
    setLoading(true); setError('')
    try {
      const [draft, live, projects] = await Promise.all([adminApi.getSettings('drafts'), adminApi.getSettings('published'), adminApi.list('projects', 'published')])
      setProjectOptions(projects.filter((item) => item.status === 'published' && item.visibility))
      const value = draft || live
      if (value) { setRecord(value); setForm({ ...EMPTY_SETTINGS, ...cleanRecord(value), socialLinks: { ...EMPTY_SETTINGS.socialLinks, ...(value.socialLinks || {}) }, seo: { ...EMPTY_SETTINGS.seo, ...(value.seo || {}) } }) }
    } catch (cause) { setError(cause.message) } finally { setLoading(false) }
  }, [apiStatus.checking, ready])
  useEffect(() => { load() }, [load])
  const field = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const save = async (publish = false) => {
    if (publish && !window.confirm(`Review portfolio settings publish\n\n${form.name}\n${form.title}\n${form.location}\n${form.bio}\n\nPublish these profile and SEO settings?`)) return
    let content
    try { content = siteSettingsSchema.parse(form) } catch (cause) { mutation.run(() => { throw new Error(cause.issues?.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' · ') || cause.message) }); return }
    const result = await mutation.run(async () => {
      const saved = await adminApi.saveSettings(content, record?.revision ?? 0)
      setRecord(saved)
      if (publish) await adminApi.publishSettings(saved.revision)
      return saved
    }, publish ? 'Portfolio settings published.' : 'Settings draft saved.')
    if (result) load()
  }
  return <><PageHeader eyebrow="PORTFOLIO CONFIGURATION" title="Settings" description="Manage profile details, About copy, and SEO settings used by the public portfolio." actions={<Button variant="brown" disabled={!ready || mutation.busy} onClick={() => save(true)}><CloudUpload size={15} /> Publish settings</Button>} />
    {!ready && <CmsConnectionNotice status={apiStatus} />}{error && <ContentError error={error} retry={load} />}{mutation.error && <Notice kind="error">{mutation.error}</Notice>}{mutation.success && <Notice kind="success">{mutation.success}</Notice>}{loading ? <LoadingPanel /> : <form className="cms-settings-grid" onSubmit={(event) => { event.preventDefault(); save(false) }}><section className="cms-editor-card"><div className="cms-section-heading"><span className="cms-step-number">01</span><div><h2>Public profile</h2><p>Profile details used in the existing portfolio components.</p></div></div><TextInput label="Portfolio name" value={form.name} onChange={(value) => field('name', value)} maxLength={120} required /><TextInput label="Professional title" value={form.title} onChange={(value) => field('title', value)} maxLength={160} /><TextArea label="Biography" value={form.bio} onChange={(value) => field('bio', value)} rows={4} maxLength={6000} /><TextArea label="About section" value={form.about} onChange={(value) => field('about', value)} rows={6} maxLength={3000} /><TextInput label="Location" value={form.location} onChange={(value) => field('location', value)} maxLength={120} /></section><section className="cms-editor-card"><div className="cms-section-heading"><span className="cms-step-number">02</span><div><h2>Social links & SEO</h2><p>Only public profile metadata belongs here.</p></div></div><TextInput label="GitHub URL" type="url" value={form.socialLinks.github} onChange={(value) => setForm((current) => ({ ...current, socialLinks: { ...current.socialLinks, github: value } }))} /><TextInput label="LinkedIn URL" type="url" value={form.socialLinks.linkedin} onChange={(value) => setForm((current) => ({ ...current, socialLinks: { ...current.socialLinks, linkedin: value } }))} /><TextInput label="Email address or mailto link" value={form.socialLinks.email?.replace(/^mailto:/, '')} onChange={(value) => setForm((current) => ({ ...current, socialLinks: { ...current.socialLinks, email: value ? `mailto:${value.replace(/^mailto:/, '')}` : '' } }))} /><div className="cms-featured-picker"><strong>Featured projects</strong><p>Selected projects appear first in the public showcase.</p>{projectOptions.length ? projectOptions.map((item) => <label key={item.id}><input type="checkbox" checked={form.featuredProjectIds.includes(item.id)} onChange={(event) => setForm((current) => ({ ...current, featuredProjectIds: event.target.checked ? [...new Set([...current.featuredProjectIds, item.id])] : current.featuredProjectIds.filter((id) => id !== item.id) }))} /><span>{item.title}</span></label>) : <small>Publish at least one project to choose featured work.</small>}</div><TextInput label="SEO page title" value={form.seo.metaTitle} onChange={(value) => setForm((current) => ({ ...current, seo: { ...current.seo, metaTitle: value } }))} maxLength={70} /><TextArea label="SEO description" value={form.seo.metaDescription} onChange={(value) => setForm((current) => ({ ...current, seo: { ...current.seo, metaDescription: value } }))} rows={4} maxLength={180} /><div className="cms-editor-actions"><span>{record ? `Draft revision v${record.revision}` : 'No saved settings'}</span><Button type="submit" disabled={!ready || mutation.busy}><Save size={14} /> Save draft</Button><Button variant="brown" disabled={!ready || mutation.busy} onClick={() => save(true)}><CloudUpload size={14} /> Save & publish</Button></div></section></form>}
  </>
}

export function CmsStorageAuditPage() {
  const apiStatus = useCmsApiStatus()
  const localMode = apiStatus.state === 'local'
  const [inventory, setInventory] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadInventory = useCallback(async () => {
    if (localMode) {
      setInventory(null)
      setError('Public Storage review is available only in the authenticated Supabase CMS.')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')
    setReviewed(false)
    try {
      setInventory(await adminApi.getPublicStorageAuditSnapshot())
    } catch (cause) {
      setInventory(null)
      setError(cause.message || 'Could not load the public Storage inventory.')
    } finally {
      setLoading(false)
    }
  }, [localMode])

  useEffect(() => {
    loadInventory()
  }, [loadInventory])

  const recordAudit = async () => {
    if (!inventory || !reviewed || busy) return
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await adminApi.recordPublicStorageAudit(inventory.snapshot)
      setReviewed(false)
      await checkCmsApiHealth()
      await loadInventory()
      setSuccess('Storage review recorded for the current inventory. Any later public-bucket change will require another review.')
    } catch (cause) {
      setError(cause.message || 'Could not record the public Storage review.')
    } finally {
      setBusy(false)
    }
  }

  return <><PageHeader eyebrow="TRUSTED OPERATOR WORKFLOW" title="Public Storage review" description="Review the public bucket configuration and every object before attesting to its current contents. The server verifies your registered administrator identity and rejects a stale inventory." showStorageNotice={false} />
    {!apiStatus.publishReady && <CmsStorageNotice status={apiStatus} />}
    {error && <Notice kind="error">{error}</Notice>}
    {success && <Notice kind="success">{success}</Notice>}
    {localMode ? <section className="cms-editor-card"><p>This workflow is not available in local filesystem mode.</p></section> : <>
      <section className="cms-editor-card">
        <div className="cms-panel-heading"><div><h2>Bucket configuration</h2><p>Confirm this is the intended public asset bucket and inspect all configuration values.</p></div><ShieldCheck size={18} /></div>
        {loading ? <LoadingPanel /> : inventory ? <div className="cms-resume-facts">
          <span><small>Bucket ID</small><strong>{inventory.bucket.id}</strong></span>
          <span><small>Name</small><strong>{inventory.bucket.name}</strong></span>
          <span><small>Visibility</small><strong>{inventory.bucket.public ? 'Public' : 'Not public'}</strong></span>
          <span><small>File size limit</small><strong>{inventory.bucket.fileSizeLimit ?? 'No configured limit'}</strong></span>
          <span><small>Allowed MIME types</small><strong>{inventory.bucket.allowedMimeTypes?.join(', ') || 'Unrestricted by bucket MIME list'}</strong></span>
        </div> : <p className="cms-muted">No reviewable inventory is loaded.</p>}
      </section>
      <section className="cms-editor-card">
        <div className="cms-panel-heading"><div><h2>Public object inventory</h2><p>{inventory ? `${inventory.objects.length} object${inventory.objects.length === 1 ? '' : 's'} currently in portfolio-published` : 'Reload the inventory to begin a review.'}</p></div><Button onClick={loadInventory} disabled={loading || busy}><RefreshCw size={14} /> Reload inventory</Button></div>
        {loading ? <LoadingPanel /> : inventory?.objects.length ? <ol className="cms-version-list">{inventory.objects.map((object) => {
          const metadata = object.metadata || {}
          const references = object.referencedBy || []
          return <li className="cms-version-row" key={object.id}>
            <div className="cms-version-marker"><FileText size={15} /></div>
            <div>
              <strong>{object.name}</strong>
              <small>{metadata.mimetype || metadata.contentType || 'Unknown content type'} · {metadata.size ? `${metadata.size} bytes` : 'Size unavailable'} · updated {object.updatedAt || 'unknown'}</small>
              <small>{references.length ? `Referenced by ${references.map((reference) => `${reference.contentType}:${reference.recordId}`).join(', ')}` : 'Not referenced by currently published CMS content — verify whether this public object should remain.'}</small>
              <a href={object.publicUrl} target="_blank" rel="noreferrer">Open public object for inspection</a>
            </div>
          </li>
        })}</ol> : inventory ? <p className="cms-muted">The bucket currently has no objects.</p> : null}
      </section>
      {inventory && !loading && <section className="cms-editor-card">
        <div className="cms-inline-toggles"><label><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I verified the bucket configuration and inspected every listed object, including unreferenced objects.</label></div>
        <p className="cms-muted">Recording this review stores the authenticated operator identity server-side. If the bucket or any object changes before recording, the server rejects this snapshot and asks you to reload and review again.</p>
        <Button variant="brown" disabled={!reviewed || busy} onClick={recordAudit}><ShieldCheck size={14} /> {busy ? 'Recording review…' : 'Record trusted-operator review'}</Button>
      </section>}
    </>}
  </>
}

function LoadingPanel() {
  return <div className="cms-loading-panel" role="status"><LoaderCircle size={19} className="cms-spinner" /> Loading CMS records…</div>
}
