// src/App.jsx
// Only assembles the page. All content lives in src/data, all UI in src/components.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScrollTrigger } from './utils/gsap'
import { useSectionTransitions } from './hooks/useSectionTransitions'
import MarqueeBand from './components/common/MarqueeBand'
import { profile as defaultProfile, sectionIds } from './data/profile'
import { useActiveSection } from './hooks/useActiveSection'
import { scrollToId } from './utils/scroll'
import SmoothScroll from './components/common/SmoothScroll'
import Navbar from './components/layout/Navbar'
import Footer from './components/layout/Footer'
import Hero from './components/sections/Hero'
import About from './components/sections/About'
import Skills from './components/sections/Skills'
import Services from './components/sections/Services'
import Background from './components/sections/Background'
import Projects from './components/sections/Projects'
import Opportunities from './components/sections/Opportunities'
import Contact from './components/sections/Contact'
import ProjectDetailsPage from './components/projects/ProjectDetailsPage'
import { usePublishedCollection } from './hooks/usePublishedCollection.js'
import { usePublishedSiteSettings } from './hooks/usePublishedDocument.js'
import { toProfileSettings, toPublicProject } from './lib/db/presentation.js'
import { PortfolioProfileProvider } from './context/PortfolioProfileContext.jsx'

function PortfolioHome() {
  const activeId = useActiveSection(sectionIds)
  const [hasInitialHash] = useState(() => Boolean(window.location.hash))
  const [introActive, setIntroActive] = useState(() => !window.location.hash)
  const handleIntroChange = useCallback((active) => setIntroActive(active), [])
  useSectionTransitions() // GSAP: sections slide over each other

  // Fonts and images change layout heights; re-measure so every trigger fires in the right place.
  useEffect(() => {
    const refresh = () => ScrollTrigger.refresh()
    document.fonts?.ready.then(refresh)
    window.addEventListener('load', refresh)
    return () => window.removeEventListener('load', refresh)
  }, [])

  // If someone opens a link like /#projects, scroll there once the layout is ready.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!id) return undefined
    const t = setTimeout(() => scrollToId(id), 400)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const section = window.location.pathname === '/projects'
      ? 'projects'
      : window.location.pathname === '/background'
        ? 'background'
        : ''
    if (!section || window.location.hash) return undefined
    const t = setTimeout(() => scrollToId(section), 400)
    return () => clearTimeout(t)
  }, [])

  return (
    <>
      <SmoothScroll />
      {/* Skip link: first Tab stop for keyboard users */}
      <a href="#main" className="sr-only z-[60] rounded-md bg-mint px-4 py-2 font-semibold text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <Navbar activeId={activeId} introActive={introActive} />
      <main id="main">
        <Hero onIntroChange={handleIntroChange} skipIntro={hasInitialHash} />
        {/* Giant scrolling type between sections: reacts to scroll speed and direction */}
        <MarqueeBand words={['APP', 'Dart', 'React', 'UI/UX']} className="bg-paper/45" />
        <About />
        <Skills />
        <Services />
        <Background />
        <MarqueeBand words={['Selected', 'Works', 'Design', 'Code']} outline reverse className="bg-soft-green/45" />
        <Projects />
        <Opportunities />
        <Contact />
      </main>
      <Footer />
    </>
  )
}

export default function App() {
  const { data: settings } = usePublishedSiteSettings()
  const effectiveProfile = useMemo(
    () => toProfileSettings(settings, defaultProfile),
    [settings],
  )

  useEffect(() => {
    const title = effectiveProfile.seo?.metaTitle || `${effectiveProfile.name} — ${effectiveProfile.title}`
    document.title = title
    const description = effectiveProfile.seo?.metaDescription || effectiveProfile.intro
    let meta = document.querySelector('meta[name="description"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'description'
      document.head.append(meta)
    }
    meta.content = description
  }, [effectiveProfile])

  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const match = pathname.match(/^\/projects\/([^/]+)$/)
  const knownPortfolioPath = pathname === '/'
    || pathname === '/projects'
    || pathname === '/background'
  const page = match
    ? <PublishedProjectRoute slug={decodeURIComponent(match[1])} />
    : knownPortfolioPath
      ? <PortfolioHome />
      : <PublicNotFound />

  return (
    <PortfolioProfileProvider value={effectiveProfile}>
      {page}
    </PortfolioProfileProvider>
  )
}

function PublicNotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-cream p-8 text-forest">
      <section className="max-w-lg text-center">
        <p className="text-xs font-bold tracking-[.16em] uppercase">Page not found</p>
        <h1 className="mt-3 font-serif text-4xl">This page isn’t available.</h1>
        <p className="mt-3 text-sm text-forest/70">The page may have moved or the address may be incorrect.</p>
        <a href="/" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-forest px-5 text-sm font-semibold text-white">Return to portfolio</a>
      </section>
    </main>
  )
}

function PublishedProjectRoute({ slug }) {
  const published = usePublishedCollection('projects')
  const publishedProject = published.data.find((record) => record.slug === slug)
  const project = publishedProject ? toPublicProject(publishedProject) : null

  if (project) return <ProjectDetailsPage project={project} />
  if (published.loading) {
    return <main className="grid min-h-screen place-items-center bg-cream p-8 text-forest" role="status">Loading project…</main>
  }
  if (published.error) {
    return (
      <main className="grid min-h-screen place-items-center bg-cream p-8 text-forest">
        <section className="max-w-lg text-center">
          <p className="text-xs font-bold tracking-[.16em] uppercase">Project unavailable</p>
          <h1 className="mt-3 font-serif text-4xl">This project could not be loaded.</h1>
          <p className="mt-3 text-sm text-forest/70">The portfolio content service is unavailable. Please try again later.</p>
          <a href="/#projects" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-forest px-5 text-sm font-semibold text-white">Return to projects</a>
        </section>
      </main>
    )
  }
  return (
    <main className="grid min-h-screen place-items-center bg-cream p-8 text-forest">
      <section className="max-w-lg text-center">
        <p className="text-xs font-bold tracking-[.16em] uppercase">Project not found</p>
        <h1 className="mt-3 font-serif text-4xl">This case study isn’t available.</h1>
        <p className="mt-3 text-sm text-forest/70">It may have been unpublished or the link may be out of date.</p>
        <a href="/#projects" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-forest px-5 text-sm font-semibold text-white">Return to projects</a>
      </section>
    </main>
  )
}
