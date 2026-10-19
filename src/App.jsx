// src/App.jsx
// Only assembles the page. All content lives in src/data, all UI in src/components.
import { useCallback, useEffect, useState } from 'react'
import { ScrollTrigger } from './utils/gsap'
import { useSectionTransitions } from './hooks/useSectionTransitions'
import MarqueeBand from './components/common/MarqueeBand'
import { sectionIds } from './data/profile'
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

export default function App() {
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
