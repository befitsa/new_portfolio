// src/components/sections/Projects.jsx
// Filterable grid with a four-project preview and an in-grid expansion tile.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { categories } from '../../data/projects'
import { gsap, ScrollTrigger } from '../../utils/gsap'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { usePublishedCollection } from '../../hooks/usePublishedCollection.js'
import { toPublicProject } from '../../lib/db/presentation.js'
import { usePortfolioProfile } from '../../context/PortfolioProfileContext.jsx'
import SectionHeading from '../common/SectionHeading'
import Button from '../common/Button'
import ProjectCard from '../projects/ProjectCard'
import Section from '../common/Section'
import { scrollToId } from '../../utils/scroll'

const INITIAL_COUNT = 4

export default function Projects() {
  const root = useRef(null)
  const [filter, setFilter] = useState('All')
  const [expanded, setExpanded] = useState(false)
  const reduced = useReducedMotion()
  const published = usePublishedCollection('projects')
  const portfolio = usePortfolioProfile()
  const projects = useMemo(() => {
    const featuredIds = new Set(portfolio.featuredProjectIds || [])
    return published.data.map(toPublicProject).sort((a, b) => {
      const aFeatured = featuredIds.size ? featuredIds.has(a.id) : a.featured
      const bFeatured = featuredIds.size ? featuredIds.has(b.id) : b.featured
      return Number(bFeatured) - Number(aFeatured) || Number(a.order || 0) - Number(b.order || 0)
    })
  }, [published.data, portfolio.featuredProjectIds])

  const filtered = useMemo(
    () => (filter === 'All' ? projects : projects.filter((p) => p.category === filter)),
    [filter, projects],
  )
  const visible = expanded ? filtered : filtered.slice(0, INITIAL_COUNT)
  const countFor = (cat) => (cat === 'All' ? projects.length : projects.filter((p) => p.category === cat).length)

  const dur = reduced ? 0 : 0.4

  useLayoutEffect(() => {
    if (!expanded || reduced || !root.current) return undefined

    const ctx = gsap.context(() => {
      const media = gsap.matchMedia()
      media.add('(min-width: 640px) and (prefers-reduced-motion: no-preference)', () => {
        gsap.from(root.current.querySelectorAll('[data-expanded-project]'), {
          y: 20,
          opacity: 0,
          duration: 0.55,
          stagger: 0.08,
          ease: 'power3.out',
        })
      })
      media.add('(max-width: 639px) and (prefers-reduced-motion: no-preference)', () => {
        gsap.from(root.current.querySelectorAll('[data-expanded-project]'), {
          y: 8,
          opacity: 0,
          duration: 0.4,
          stagger: 0.04,
          ease: 'power2.out',
        })
      })
      return () => media.revert()
    }, root)

    return () => ctx.revert()
  }, [expanded, reduced])

  // The page gets taller/shorter when filtering, so tell ScrollTrigger to re-measure.
  useEffect(() => {
    const t = setTimeout(() => ScrollTrigger.refresh(), 600)
    return () => clearTimeout(t)
  }, [filter, expanded])

  return (
    <Section id="projects" className="overflow-x-clip bg-cream py-24 md:py-32">
      <div className="mx-auto max-w-[90rem] px-5 md:px-10">
        <SectionHeading
          label="Selected Works"
          title="Projects"
          description="A curated collection of projects where design meets intention."
        />

        <div role="group" aria-label="Filter projects by category" className="mt-12 flex flex-wrap gap-2">
          {categories.map((cat) => {
            const selected = filter === cat
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={selected}
                onClick={() => { setFilter(cat); setExpanded(false) }}
                className={`relative rounded-full px-5 py-2.5 text-sm font-semibold transition-colors ${selected ? 'text-ink' : 'text-forest/70 ring-1 ring-forest/15 hover:text-forest hover:ring-forest/40'}`}
              >
                {selected && (
                  <motion.span
                    layoutId="filter-pill"
                    className="absolute inset-0 rounded-full bg-mint"
                    transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 34 }}
                  />
                )}
                <span className="relative">{cat} <span className="opacity-60">{countFor(cat)}</span></span>
              </button>
            )
          })}
        </div>

        <p className="sr-only" aria-live="polite">Showing {visible.length} of {filtered.length} projects</p>

        <motion.ul ref={root} id="project-grid" layout className="mt-14 grid gap-x-10 gap-y-16 md:grid-cols-2 lg:gap-x-16">
          <AnimatePresence mode="popLayout">
            {visible.map((project, i) => (
              <motion.li
                key={project.id}
                layout={!reduced}
                initial={false}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: dur, delay: reduced ? 0 : i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                // Every second card drops down: the staggered, editorial alignment.
                className={i % 2 === 1 ? 'md:mt-28' : ''}
              >
                <div data-expanded-project={expanded && i >= INITIAL_COUNT ? '' : undefined}>
                  <ProjectCard project={project} />
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>

        {!expanded && filtered.length > INITIAL_COUNT && (
          <div className="mt-16 flex justify-center">
            <Button
              type="button"
              variant="outlineDark"
              arrow
              onClick={() => setExpanded(true)}
              aria-expanded={expanded}
              aria-controls="project-grid"
            >
              See More Projects
            </Button>
          </div>
        )}

        {published.loading && (
          <p className="mt-12 text-forest/70" role="status">Loading published projects…</p>
        )}

        {published.error && (
          <p className="mt-12 text-forest/80" role="alert">Projects could not be loaded right now. Please try again later.</p>
        )}

        {!published.loading && !published.error && filtered.length === 0 && (
          <p className="mt-12 text-forest/80">No projects have been published yet.</p>
        )}

        {expanded && filtered.length > INITIAL_COUNT && (
          <div className="mt-16 flex justify-center">
            <Button
              variant="outlineDark"
              onClick={() => {
                setExpanded(false)
                requestAnimationFrame(() => scrollToId('opportunities'))
              }}
              aria-expanded={expanded}
              aria-controls="project-grid"
            >
              Show Less
            </Button>
          </div>
        )}
      </div>
    </Section>
  )
}
