import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Code2,
  ExternalLink,
  Mail,
  X,
} from 'lucide-react'
import { usePortfolioProfile } from '../../context/PortfolioProfileContext.jsx'
import MarkdownContent from '../common/MarkdownContent.jsx'
import BrandLink from '../common/BrandLink.jsx'
import { projectDetailsPath } from '../../data/projects'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useScrollTriggerRefresh } from '../../hooks/useScrollTriggerRefresh'
import { gsap } from '../../utils/gsap'
import { normalizeTechnologyStack } from '../../lib/db/contentSchemas.js'
import { warnProjectImageLoadFailure } from '../../utils/projectImageErrors'

const cardPastels = ['bg-[#edf4e9]', 'bg-[#eaf2f8]', 'bg-[#f7f0e5]', 'bg-[#e8f3ed]', 'bg-[#f2e9e2]', 'bg-[#f6efdb]']
const excludedFeatureTitles = new Set(['responsive design', 'reusable components', 'user experience', 'scalability'])
const isRemovedFeature = (value) => excludedFeatureTitles.has(
  String(value || '').split(/\s+[—–-]\s+/)[0].trim().toLowerCase(),
)

const sections = [
  { id: 'overview', label: 'Overview' },
  { id: 'technical-highlights', label: 'Technical Highlights' },
  { id: 'impact-outcomes', label: 'Impact & Outcomes' },
  { id: 'tech-stack', label: 'Tech Stack' },
  { id: 'interface-gallery', label: 'Interface Gallery' },
]

function displayValue(value) {
  if (typeof value === 'string') return value
  return value?.title ?? value?.name ?? ''
}

function EvidenceNote({ children }) {
  return (
    <div className="flex min-h-20 items-start gap-3 rounded-xl border border-dashed border-forest/20 bg-white/70 p-4 text-sm leading-relaxed text-forest/65">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-[#b56a20]" aria-hidden="true" />
      <p>{children}</p>
    </div>
  )
}

function TechnologyLogo({ technology, projectTitle }) {
  const name = displayValue(technology.name || technology.title)
  const source = typeof technology.logo === 'string' ? technology.logo : technology.logo?.url || ''
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [source])

  if (!source || failed) {
    return <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/70 font-serif text-lg text-[#398b69]">{name.charAt(0).toUpperCase() || '?'}</span>
  }
  return <img src={source} alt={`${name} logo`} onError={() => {
    warnProjectImageLoadFailure(projectTitle, `technology logo (${name})`, source)
    setFailed(true)
  }} className="size-12 shrink-0 object-contain" />
}

function ActionLink({ href, children, secondary = false }) {
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-xs font-semibold transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#c9a14a] sm:px-5 sm:text-sm ${
        secondary
          ? 'border border-forest/20 bg-white text-forest hover:border-forest/45'
          : 'bg-[#d96800] text-white shadow-[0_8px_18px_rgba(180,85,0,.2)] hover:bg-[#bd5900]'
      }`}
    >
      {children}
    </a>
  )
}

function ProjectImageViewer({ images, index, onClose, onNavigate, projectTitle }) {
  const closeButton = useRef(null)
  const dialog = useRef(null)
  const reduced = useReducedMotion()
  const image = images[index]
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => setImageFailed(false), [image.src])

  useEffect(() => {
    const priorFocus = document.activeElement
    const priorOverflow = document.body.style.overflow
    closeButton.current?.focus()
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') onNavigate(-1)
      if (event.key === 'ArrowRight') onNavigate(1)
      if (event.key === 'Tab') {
        const focusable = dialog.current?.querySelectorAll('button:not([disabled]), a[href]')
        if (!focusable?.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = priorOverflow
      priorFocus?.focus?.()
    }
  }, [onClose, onNavigate])

  return (
    <motion.div
      className="fixed inset-0 z-[100] grid place-items-center bg-ink/70 p-4 backdrop-blur-sm"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.2 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <motion.section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-image-title"
        className="relative max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl bg-paper p-4 shadow-2xl sm:p-7"
        initial={reduced ? false : { opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ duration: reduced ? 0 : 0.2 }}
      >
        <div className="flex items-start justify-between gap-4 pr-12">
          <div>
            <p className="text-[10px] font-semibold tracking-[.14em] text-forest/55 uppercase">Project gallery</p>
            <h2 id="project-image-title" className="mt-1 font-serif text-2xl">{image.title}</h2>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close image viewer"
            className="absolute top-3 right-3 grid size-11 place-items-center rounded-full border border-forest/15 text-forest hover:bg-soft-green"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {imageFailed ? <div className="mt-5 grid min-h-48 place-items-center rounded-xl bg-soft-green p-6 text-sm text-forest/65">This project image is unavailable.</div> : <img src={image.src} alt={image.alt} onError={() => {
          warnProjectImageLoadFailure(projectTitle, 'gallery viewer', image.src)
          setImageFailed(true)
        }} className="mt-5 max-h-[68vh] w-full rounded-xl bg-soft-green object-contain object-center" />}
        {images.length > 1 && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <button type="button" onClick={() => onNavigate(-1)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-forest/20 px-4 text-sm font-semibold text-forest hover:bg-soft-green">
              <ArrowLeft size={16} aria-hidden="true" /> Previous
            </button>
            <span className="text-xs text-forest/60">{index + 1} / {images.length}</span>
            <button type="button" onClick={() => onNavigate(1)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-forest/20 px-4 text-sm font-semibold text-forest hover:bg-soft-green">
              Next <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </motion.section>
    </motion.div>
  )
}

function GalleryImage({ image, projectTitle }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [image.src])
  if (failed) return <span className="grid aspect-[16/10] w-full place-items-center bg-soft-green px-4 text-center text-xs text-forest/65">Image unavailable</span>
  return <img src={image.src} alt={image.alt || `${projectTitle} interface`} loading="lazy" draggable="false" onError={() => {
    warnProjectImageLoadFailure(projectTitle, 'gallery', image.src)
    setFailed(true)
  }} className="aspect-[16/10] w-full bg-[#eef4ef] object-contain object-center" />
}

export default function ProjectDetailsPage({ project }) {
  const profile = usePortfolioProfile()
  const contentRef = useRef(null)
  const galleryRef = useRef(null)
  const draggedGallery = useRef(false)
  const [activeSection, setActiveSection] = useState(sections[0].id)
  const [selectedImage, setSelectedImage] = useState(null)
  const [coverImageFailed, setCoverImageFailed] = useState(false)
  const [galleryEdges, setGalleryEdges] = useState({ left: false, right: false })
  const reduced = useReducedMotion()

  useScrollTriggerRefresh()

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('project-details-active')
    return () => root.classList.remove('project-details-active')
  }, [])

  useEffect(() => {
    const gallery = galleryRef.current
    if (!gallery) return undefined

    let drag
    const onPointerDown = (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return
      drag = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: gallery.scrollLeft, moved: false }
      gallery.classList.add('is-dragging')
    }
    const onPointerMove = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return
      const distance = event.clientX - drag.startX
      if (Math.abs(distance) > 4) drag.moved = true
      if (drag.moved) {
        event.preventDefault()
        gallery.scrollLeft = drag.startScrollLeft - distance
      }
    }
    const endDrag = (event) => {
      if (!drag || (event && event.pointerId !== drag.pointerId)) return
      if (drag.moved) {
        draggedGallery.current = true
        window.setTimeout(() => { draggedGallery.current = false }, 0)
      }
      drag = undefined
      gallery.classList.remove('is-dragging')
    }
    const onWheel = (event) => {
      if (gallery.scrollWidth <= gallery.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      gallery.scrollBy({ left: event.deltaY, behavior: 'smooth' })
      event.preventDefault()
    }

    gallery.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    gallery.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      gallery.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      gallery.removeEventListener('wheel', onWheel)
      gallery.classList.remove('is-dragging')
    }
  }, [project.slug])

  useLayoutEffect(() => {
    const root = contentRef.current
    if (!root || reduced) return undefined

    const ctx = gsap.context(() => {
      const media = gsap.matchMedia()
      const animateContent = (distance, duration) => {
        gsap.utils.toArray('[data-case-study-reveal]', root).forEach((section) => {
          const content = section.firstElementChild
          if (!content) return
          const targets = content.children.length
            ? [...content.children]
            : [...section.children]
          gsap.from(targets, {
            y: distance,
            opacity: 0,
            duration,
            ease: 'power3.out',
            stagger: 0.07,
            scrollTrigger: { trigger: section, start: 'top 88%', once: true },
          })
        })
      }

      const highlightTrack = root.querySelector('[data-project-highlights]')
      const highlightCards = highlightTrack?.querySelectorAll('[data-project-highlight]')
      if (highlightCards?.length) {
        gsap.from(highlightCards, {
          x: -36,
          opacity: 0,
          duration: 0.7,
          ease: 'power3.out',
          stagger: 0.14,
          scrollTrigger: { trigger: highlightTrack, start: 'top 82%', once: true },
        })
      }

      const impactTrack = root.querySelector('[data-project-impact-metrics]')
      const impactCards = impactTrack?.querySelectorAll('[data-project-impact-card]')
      if (impactCards?.length) {
        gsap.from(impactCards, {
          x: -24,
          opacity: 0,
          duration: 0.65,
          ease: 'power3.out',
          stagger: 0.12,
          scrollTrigger: { trigger: impactTrack, start: 'top 88%', once: true },
        })
      }

      media.add('(min-width: 640px)', () => {
        animateContent(16, 0.7)
      })
      media.add('(max-width: 639px)', () => {
        animateContent(8, 0.5)
      })
      return () => media.revert()
    }, root)

    return () => ctx.revert()
  }, [project.slug, reduced])

  useEffect(() => setCoverImageFailed(false), [project.detailCoverImage])
  const galleryImages = useMemo(() => {
    const screenshots = Array.isArray(project.galleryImages)
      ? project.galleryImages.filter((image) => image?.src)
      : []
    return screenshots.map((image) => ({
      src: image.src,
      title: image.title || 'Project interface',
      alt: image.alt || `${project.title} interface`,
    }))
  }, [project.galleryImages, project.title])

  const closeViewer = useCallback(() => setSelectedImage(null), [])
  const navigateViewer = useCallback((direction) => {
    setSelectedImage((current) => {
      if (current === null || !galleryImages.length) return current
      return (current + direction + galleryImages.length) % galleryImages.length
    })
  }, [galleryImages.length])

  useEffect(() => {
    const previousTitle = document.title
    const updateMeta = (selector, key, value) => {
      let element = document.querySelector(selector)
      const created = !element
      if (!element) {
        element = document.createElement('meta')
        element.setAttribute(selector.includes('[property=') ? 'property' : 'name', key)
        document.head.appendChild(element)
      }
      const previous = element.content
      element.content = value
      return () => { if (created) element.remove(); else element.content = previous }
    }
    const title = project.seo?.metaTitle?.trim() || `${project.title} — ${profile.name}`
    const description = project.seo?.metaDescription?.trim() || project.summary || project.description || ''
    document.title = title
    const restoreDescription = updateMeta('meta[name="description"]', 'description', description)
    const restoreOgTitle = updateMeta('meta[property="og:title"]', 'og:title', title)
    const restoreOgDescription = updateMeta('meta[property="og:description"]', 'og:description', description)
    return () => {
      document.title = previousTitle
      restoreDescription(); restoreOgTitle(); restoreOgDescription()
    }
  }, [project.title, project.summary, project.description, project.seo, profile.name])

  useEffect(() => {
    const targets = sections.map(({ id }) => document.getElementById(id)).filter(Boolean)
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((first, second) => second.intersectionRatio - first.intersectionRatio)
      if (visible[0]) setActiveSection(visible[0].target.id)
    }, { rootMargin: '-18% 0px -66% 0px', threshold: [0, 0.15, 0.35, 0.6] })

    targets.forEach((target) => observer.observe(target))
    return () => observer.disconnect()
  }, [project.slug])

  const features = Array.isArray(project.features) ? project.features.filter((feature) => {
    const title = typeof feature === 'string' ? feature : feature?.title ?? feature?.name ?? ''
    return !isRemovedFeature(title)
  }) : []
  const outcomes = Array.isArray(project.outcomes) ? project.outcomes.filter(Boolean) : []
  const metrics = Array.isArray(project.metrics) ? project.metrics.filter(Boolean) : []
  const heroMetrics = metrics.filter((metric) => {
    const label = typeof metric === 'string' ? metric : metric?.label ?? metric?.title ?? ''
    return !isRemovedFeature(label)
  })
  const technologies = normalizeTechnologyStack(project.tech)
  const screenshots = Array.isArray(project.galleryImages) ? project.galleryImages.filter((image) => image?.src) : []
  const titleWords = project.title.trim().split(/\s+/)
  const titleAccent = titleWords.pop()

  useEffect(() => {
    const gallery = galleryRef.current
    if (!gallery) return undefined

    const updateEdges = () => {
      const maxScroll = gallery.scrollWidth - gallery.clientWidth
      const left = gallery.scrollLeft > 1
      const right = gallery.scrollLeft < maxScroll - 1
      setGalleryEdges((current) => current.left === left && current.right === right ? current : { left, right })
    }

    updateEdges()
    gallery.addEventListener('scroll', updateEdges, { passive: true })
    window.addEventListener('resize', updateEdges)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateEdges)
    observer?.observe(gallery)
    return () => {
      gallery.removeEventListener('scroll', updateEdges)
      window.removeEventListener('resize', updateEdges)
      observer?.disconnect()
    }
  }, [project.slug, screenshots.length])

  const scrollGallery = (direction) => {
    const gallery = galleryRef.current
    const firstItem = gallery?.querySelector('.project-gallery-image')
    if (!gallery || !firstItem) return
    const gap = Number.parseFloat(getComputedStyle(gallery).columnGap) || 0
    gallery.scrollBy({ left: direction * (firstItem.getBoundingClientRect().width + gap), behavior: 'smooth' })
  }

  return (
    <div className="project-details-page min-h-screen bg-[#f7faf7] text-[#14271e]">
      <a href="#main" className="sr-only z-[110] rounded-md bg-white px-4 py-2 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>

      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8">
        <BrandLink href="/" ariaLabel="Fitsum portfolio home" logoSize={34} className="min-h-11 text-xs font-semibold tracking-wide text-forest" />
        {project.liveUrl && <ActionLink href={project.liveUrl}><ExternalLink size={14} aria-hidden="true" /> Live Demo</ActionLink>}
      </header>

      <main id="main" ref={contentRef}>
        <section data-case-study-reveal className="mx-auto max-w-7xl px-5 pt-7 pb-10 sm:px-8 sm:pt-11 sm:pb-12">
          <div className="mx-auto mb-4 flex max-w-6xl justify-start">
            <a href="/#projects" aria-label="Back to projects" title="Back to projects" className="grid size-11 shrink-0 place-items-center rounded-full bg-[#c9a14a] text-[#17251b] shadow-sm transition duration-200 hover:-translate-x-0.5 hover:bg-[#d6b15d] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#8f6e2d] active:scale-95">
              <ArrowLeft size={19} strokeWidth={2.2} aria-hidden="true" />
            </a>
          </div>
          <div className="mx-auto max-w-4xl text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#e5cda9] bg-white/80 px-3 py-1.5 text-[9px] font-bold tracking-[.12em] text-[#a55a0a] uppercase sm:text-[10px]">
              <span className="size-1.5 rounded-full bg-[#d96800]" />
              {project.isPlaceholder ? 'Project details pending' : project.category}
            </p>
            <h1 className="mt-4 font-serif text-[clamp(2.2rem,6.5vw,4.7rem)] leading-[.98] tracking-tight">
              {titleWords.length > 0 && `${titleWords.join(' ')} `}
              <span className="italic text-[#d96800]">{titleAccent}</span>
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-xs leading-relaxed text-forest/70 sm:text-sm">
              {project.description && !project.isPlaceholder
                ? project.description
                : 'Project description and case-study information have not been added yet.'}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[10px] text-forest/65 sm:gap-x-5 sm:text-xs">
              <span><strong className="font-semibold text-forest">Category:</strong> {project.category}</span>
              {project.role && <span><strong className="font-semibold text-forest">Role:</strong> {project.role}</span>}
              {project.timeline && <span><strong className="font-semibold text-forest">Timeline:</strong> {project.timeline}</span>}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#a9dac5] bg-[#effaf4] px-2.5 py-1 font-semibold text-forest">
                <span className="size-1.5 rounded-full bg-[#2e9c68]" />
                {project.status || 'Status not provided'}
              </span>
            </div>
          </div>

          {heroMetrics.length > 0 && (
            <div
              className="project-impact-metrics mx-auto mt-7 grid max-w-6xl gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
              data-project-impact-metrics
              role="region"
              aria-label="Project impact metrics"
              tabIndex={0}
            >
              {heroMetrics.map((metric, index) => {
                const item = typeof metric === 'string' ? { label: metric } : metric
                return (
                  <article key={`${item.label || item.title || 'metric'}-${index}`} data-project-impact-card className="project-impact-card rounded-xl border border-forest/10 bg-white/90 p-3 shadow-[0_5px_18px_rgba(31,57,42,.04)]">
                    {item.label && <p className="text-[9px] font-semibold tracking-[.12em] text-forest/55 uppercase">{item.label}</p>}
                    {item.value && <p className="mt-1 font-serif text-xl">{item.value}</p>}
                    {item.description && <p className="mt-1 text-[10px] leading-relaxed text-forest/55">{item.description}</p>}
                  </article>
                )
              })}
            </div>
          )}

        </section>

        <nav aria-label="Project sections" className="sticky top-0 z-40 border-y border-forest/10 bg-[#f7faf7]/95 backdrop-blur-md">
          <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-1.5 sm:justify-center sm:px-8">
            {sections.map(({ id, label }) => (
              <li key={id} className="shrink-0">
                <a href={`#${id}`} aria-current={activeSection === id ? 'location' : undefined} className={`inline-flex min-h-9 items-center rounded-full px-3 text-[10px] font-semibold transition sm:px-4 sm:text-xs ${activeSection === id ? 'bg-[#e4f0e9] text-forest' : 'text-forest/60 hover:bg-white hover:text-forest'}`}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mx-auto mt-6 max-w-6xl px-5 sm:px-8">
          <div className="overflow-hidden rounded-[1.25rem] border border-forest/10 bg-white shadow-[0_12px_32px_rgba(31,57,42,.09)]">
            <div className="flex items-center justify-between border-b border-forest/10 bg-[#f7faf7] px-4 py-2.5 sm:px-6">
              <div className="flex gap-1.5" aria-hidden="true">
                <span className="size-2 rounded-full bg-[#f18875]" /><span className="size-2 rounded-full bg-[#f1c265]" /><span className="size-2 rounded-full bg-[#83c69a]" />
              </div>
              <span className="text-[8px] font-semibold tracking-[.12em] text-forest/50 uppercase sm:text-[9px]">{project.title} preview</span>
              <span className="text-[8px] text-forest/45 sm:text-[9px]">{project.detailCoverImage && !coverImageFailed ? 'Project cover' : 'Preview unavailable'}</span>
            </div>
            {project.detailCoverImage && !coverImageFailed ? (
              <div className="bg-[#eef4ef]">
                <img src={project.detailCoverImage} alt={`${project.title} project preview`} onError={() => {
                  warnProjectImageLoadFailure(project.title, 'cover', project.detailCoverImage)
                  setCoverImageFailed(true)
                }} className="max-h-[min(60vh,34rem)] min-h-48 w-full object-contain object-center sm:min-h-64" />
              </div>
            ) : (
              <div className="grid min-h-44 place-items-center bg-[radial-gradient(ellipse_at_top,_rgba(221,232,216,.5),_transparent_65%)] px-6 py-8 text-center sm:min-h-64">
                <p className="max-w-lg text-sm leading-relaxed text-forest/65">
                  {coverImageFailed ? 'The project cover could not be loaded.' : 'No project cover image is available.'}
                </p>
              </div>
            )}
          </div>
        </div>

        <section id="overview" data-case-study-reveal className="scroll-mt-16 border-b border-forest/10 bg-white py-11 sm:scroll-mt-20 sm:py-16">
          <div className="mx-auto grid max-w-6xl gap-7 px-5 sm:px-8 lg:grid-cols-[1.2fr_.8fr] lg:gap-12">
            <div>
              <p className="text-[9px] font-bold tracking-[.16em] text-[#bd6a29] uppercase">01 / Overview</p>
              <h2 className="mt-2 font-serif text-2xl sm:text-3xl">Executive Summary &amp; Problem Statement</h2>
              {project.summary && <MarkdownContent className="portfolio-markdown mt-4 text-xs leading-6 text-forest/70 sm:text-sm" source={project.summary} />}
              {project.problem && (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold text-forest">Problem statement</h3>
                  <p className="mt-2 text-xs leading-6 text-forest/70 sm:text-sm">{project.problem}</p>
                </div>
              )}
              {!project.summary && !project.problem && (
                <p className="mt-4 text-xs leading-6 text-forest/70 sm:text-sm">
                  {project.description && !project.isPlaceholder ? project.description : 'A project summary and problem statement have not been provided.'}
                </p>
              )}
            </div>
            <aside className="rounded-xl border border-[#f1d7dc] bg-[#fff8f8] p-4 sm:p-5">
              <h3 className="text-xs font-bold text-[#7e3745]">Project information</h3>
              <ul className="mt-3 space-y-2.5 text-[11px] leading-relaxed text-[#704d54] sm:text-xs">
                <li><strong>Category:</strong> {project.category}</li>
                {project.role && <li><strong>Role:</strong> {project.role}</li>}
                {project.timeline && <li><strong>Timeline:</strong> {project.timeline}</li>}
                {project.isPlaceholder && <li>This project record is still marked as a placeholder.</li>}
              </ul>
            </aside>
          </div>
        </section>

        <section id="technical-highlights" data-case-study-reveal className="scroll-mt-16 border-b border-forest/10 bg-[#f2f7f3] py-11 sm:scroll-mt-20 sm:py-16">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <p className="text-[9px] font-bold tracking-[.16em] text-[#bd6a29] uppercase">02 / Engineering</p>
            <h2 className="mt-2 font-serif text-2xl sm:text-3xl">Technical Highlights &amp; Architecture</h2>
            <div className="mt-6">
              {features.length ? (
                <div className="case-study-highlight-track" data-project-highlights>
                  {features.map((feature, index) => {
                    const item = typeof feature === 'string' ? { title: feature } : feature
                    return (
                      <motion.article key={`${item.title || item.name}-${index}`} data-project-highlight whileHover={reduced ? undefined : { y: -3 }} className={`case-study-card-slide min-h-32 rounded-xl border border-forest/10 ${cardPastels[index % cardPastels.length]} p-4 shadow-[0_5px_16px_rgba(31,57,42,.04)]`}>
                        <h3 className="text-sm font-semibold">{displayValue(item.title || item.name)}</h3>
                        {item.description && <p className="mt-2 text-[11px] leading-relaxed text-forest/65">{item.description}</p>}
                        {item.implementation && <p className="mt-2 text-[11px] leading-relaxed text-forest/65"><strong>Implementation:</strong> {item.implementation}</p>}
                      </motion.article>
                    )
                  })}
                </div>
              ) : (
                <EvidenceNote>No technical highlights or architecture details have been added to this project record.</EvidenceNote>
              )}
            </div>
          </div>
        </section>

        <section id="impact-outcomes" data-case-study-reveal className="scroll-mt-16 border-b border-forest/10 bg-white py-11 sm:scroll-mt-20 sm:py-16">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <p className="text-[9px] font-bold tracking-[.16em] text-[#bd6a29] uppercase">03 / Results</p>
            <h2 className="mt-2 font-serif text-2xl sm:text-3xl">Impact &amp; Measured Outcomes</h2>
            <div className="mt-6">
              {outcomes.length ? (
                <div className="case-study-card-track grid gap-3 md:grid-cols-2">
                  {outcomes.map((outcome, index) => {
                    const item = typeof outcome === 'string' ? { title: outcome } : outcome
                    return (
                      <article key={`${item.title || item.name}-${index}`} className={`case-study-card-slide rounded-xl border border-forest/10 ${cardPastels[index % cardPastels.length]} p-4 sm:p-5`}>
                        <h3 className="text-sm font-semibold">{displayValue(item.title || item.name)}</h3>
                        {item.description && <p className="mt-2 text-xs leading-relaxed text-forest/65">{item.description}</p>}
                      </article>
                    )
                  })}
                </div>
              ) : (
                <EvidenceNote>No measured outcomes have been supplied for this project.</EvidenceNote>
              )}
            </div>
            {metrics.length > 0 && (
              <div className="case-study-card-track mt-4 grid gap-3 sm:grid-cols-3">
                {metrics.map((metric, index) => {
                  const item = typeof metric === 'string' ? { value: metric } : metric
                  return (
                    <article key={`outcome-${item.label || item.title || index}`} className={`case-study-card-slide rounded-xl border border-forest/10 ${cardPastels[(index + outcomes.length) % cardPastels.length]} p-4 text-center`}>
                      {item.value && <p className="font-serif text-3xl">{item.value}</p>}
                      <p className="mt-1 text-xs font-semibold text-forest">{item.label || item.title}</p>
                      {item.description && <p className="mt-1 text-[10px] leading-relaxed text-forest/60">{item.description}</p>}
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        <section id="tech-stack" data-case-study-reveal className="scroll-mt-16 border-b border-forest/10 bg-[#f2f7f3] py-11 sm:scroll-mt-20 sm:py-16">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <p className="text-left text-[9px] font-bold tracking-[.16em] text-[#bd6a29] uppercase">04 / Tools &amp; Stack</p>
            <h2 className="mt-2 text-left font-serif text-2xl sm:text-3xl">Technologies Employed</h2>
            <div className="mx-auto mt-6 max-w-5xl">
              {technologies.length ? (
                <ul className="case-study-card-track case-study-technology-track grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {technologies.map((technology, index) => {
                    const item = typeof technology === 'string' ? { name: technology } : technology
                    const card = (
                      <div className="flex h-full min-w-0 flex-col items-center text-center">
                        <TechnologyLogo technology={item} projectTitle={project.title} />
                        <span className="mt-3 block w-full break-words text-xs font-semibold">{displayValue(item.name || item.title)}</span>
                        {item.description && <span className="mt-1 block w-full break-words text-[10px] leading-relaxed text-forest/70">{item.description}</span>}
                        {item.url && <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-forest">Documentation <ExternalLink size={11} aria-hidden="true" /></span>}
                      </div>
                    )
                    return (
                      <li key={`${displayValue(item.name || item.title)}-${index}`} className="case-study-card-slide">
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noopener noreferrer" className={`block h-full rounded-xl border border-forest/10 ${cardPastels[index % cardPastels.length]} p-4 shadow-[0_5px_16px_rgba(31,57,42,.04)] transition hover:-translate-y-1 hover:shadow-md focus-visible:outline-2 focus-visible:outline-mint`}>{card}</a>
                        ) : (
                          <div className={`h-full rounded-xl border border-forest/10 ${cardPastels[index % cardPastels.length]} p-4 shadow-[0_5px_16px_rgba(31,57,42,.04)] transition duration-200 hover:-translate-y-1 hover:shadow-md`}>{card}</div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <EvidenceNote>No technologies have been added to this project record.</EvidenceNote>
              )}
            </div>
          </div>
        </section>

        <section id="interface-gallery" data-case-study-reveal className="scroll-mt-16 border-b border-forest/10 bg-white py-11 sm:scroll-mt-20 sm:py-16">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <p className="text-[9px] font-bold tracking-[.16em] text-[#bd6a29] uppercase">05 / User Experience</p>
            <h2 className="mt-2 font-serif text-2xl sm:text-3xl">Interface Gallery &amp; User Journeys</h2>
            {screenshots.length ? (
              <div className="mt-6">
                <div className="mb-3 hidden justify-end gap-2 sm:flex">
                  <button
                    type="button"
                    onClick={() => scrollGallery(-1)}
                    disabled={!galleryEdges.left}
                    aria-label="Scroll to previous project images"
                    className="grid size-10 place-items-center rounded-full border border-forest/15 bg-white text-forest transition hover:bg-[#f2f7f3] active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronLeft size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollGallery(1)}
                    disabled={!galleryEdges.right}
                    aria-label="Scroll to next project images"
                    className="grid size-10 place-items-center rounded-full border border-forest/15 bg-white text-forest transition hover:bg-[#f2f7f3] active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                </div>
                <div
                  ref={galleryRef}
                  className="project-gallery-track"
                  data-lenis-prevent-wheel
                  role="region"
                  aria-label="Project interface images"
                  tabIndex={0}
                  onClickCapture={(event) => {
                    if (draggedGallery.current) {
                      event.preventDefault()
                      event.stopPropagation()
                      draggedGallery.current = false
                    }
                  }}
                >
                  {screenshots.map((image) => (
                    <button key={image.src} type="button" onClick={() => setSelectedImage(galleryImages.findIndex((entry) => entry.src === image.src))} aria-label={`Open image: ${image.title || 'Project interface'}`} className="project-gallery-image group overflow-hidden rounded-xl border border-forest/10 bg-[#f7faf7] text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                      <GalleryImage image={image} projectTitle={project.title} />
                      <span className="flex min-h-10 items-center justify-between px-4 text-xs font-semibold">{image.title || 'Project interface'}<ArrowUpRight size={14} aria-hidden="true" /></span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-5">
                <EvidenceNote>No additional interface screenshots or user-journey images have been added to this project.</EvidenceNote>
              </div>
            )}
          </div>
        </section>

        {(project.sourceUrl || project.figmaUrl) && (
          <div className="flex flex-wrap justify-center gap-3 bg-[#f7faf7] px-5 py-7 sm:px-8">
            {project.sourceUrl && <ActionLink href={project.sourceUrl} secondary><Code2 size={14} aria-hidden="true" /> View Code</ActionLink>}
            {project.figmaUrl && <ActionLink href={project.figmaUrl} secondary><ExternalLink size={14} aria-hidden="true" /> Figma Prototype</ActionLink>}
          </div>
        )}

        <section data-case-study-reveal className="bg-[#eaf3ed] px-5 py-12 text-center sm:px-8 sm:py-16">
          <p className="text-[9px] font-bold tracking-[.16em] text-[#bd6a29] uppercase">Next milestone</p>
          <h2 className="mx-auto mt-2 max-w-2xl font-serif text-2xl leading-tight sm:text-4xl">Interested in Building a High-Impact Solution?</h2>
          <p className="mx-auto mt-3 max-w-xl text-xs leading-relaxed text-forest/65 sm:text-sm">Let&apos;s discuss your next project, or return to the portfolio to explore the other work.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {profile.email && (
              <a href={`mailto:${profile.email}`} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#d96800] px-5 text-xs font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#bd5900] sm:text-sm">
                <Mail size={14} aria-hidden="true" /> Let&apos;s Collaborate <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            )}
            <a href="/#projects" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-forest/20 bg-white px-5 text-xs font-semibold text-forest transition hover:border-forest/50 sm:text-sm">
              <ArrowLeft size={14} aria-hidden="true" /> Back to Projects
            </a>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-7xl flex-col gap-3 border-t border-forest/10 px-5 py-5 text-[10px] text-forest/60 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:text-xs">
        <a href="/" className="font-semibold text-forest">{profile.name}</a>
        <nav aria-label="Social links" className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {profile.socials.filter(({ url }) => url).map(({ id, label, url }) => {
            const external = /^https?:\/\//.test(url)
            return (
              <a key={id} href={url} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="inline-flex min-h-9 items-center gap-1 hover:text-forest">
                {label}{external && <ExternalLink size={10} aria-hidden="true" />}
              </a>
            )
          })}
        </nav>
      </footer>

      <AnimatePresence>
        {selectedImage !== null && galleryImages[selectedImage] && (
          <ProjectImageViewer images={galleryImages} index={selectedImage} onClose={closeViewer} onNavigate={navigateViewer} projectTitle={project.title} />
        )}
      </AnimatePresence>
    </div>
  )
}
