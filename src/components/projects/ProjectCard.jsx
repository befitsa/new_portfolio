// src/components/projects/ProjectCard.jsx
// One project: a preview (image, real 3D scene, or designed placeholder) plus
// text and action links. Links without a URL are simply not rendered.
import { lazy, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { BookOpen, Code, ExternalLink } from 'lucide-react'
import { gsap } from '../../utils/gsap'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import LazyScene from '../three/LazyScene'

const ProjectScene = lazy(() => import('../three/ProjectScene'))

function Preview({ project }) {
  const [imageFailed, setImageFailed] = useState(false)
  const hasImage = Boolean(project.image) && !imageFailed
  // Big number/letter on the placeholder: the slot number, or the first letter of a real title.
  const mark = /\d+$/.exec(project.id)?.[0] ?? project.title.charAt(0)

  return (
    <div className="absolute inset-0 bg-forest">
      {/* Designed placeholder: always underneath, so there is never an empty or broken box. */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(166,182,170,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(166,182,170,0.07)_1px,transparent_1px)] bg-size-[32px_32px]" />
      <div className="absolute inset-0 grid place-items-center">
        <span className="font-display text-[clamp(4rem,10vw,7rem)] font-semibold text-ivory/[0.08] select-none">{mark}</span>
      </div>

      {hasImage ? (
        <img
          src={project.image}
          alt={`${project.title} preview`}
          loading="lazy" // below the fold: don't download until needed
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        project.preview3d && (
          <LazyScene className="absolute inset-0" margin="150px">
            <ProjectScene variant={project.preview3d} interactive={project.id !== 'project-01'} />
          </LazyScene>
        )
      )}
    </div>
  )
}

export default function ProjectCard({ project, wide, number }) {
  const reduced = useReducedMotion()
  const root = useRef(null)
  const frame = useRef(null)

  // GSAP reveal: the preview opens from a small rounded window to full size as it scrolls into view,
  // while the text underneath slides up a beat later.
  useLayoutEffect(() => {
    if (reduced) return undefined
    const ctx = gsap.context(() => {
      const trigger = { trigger: root.current, start: 'top 88%', once: true }
      gsap.fromTo(
        frame.current,
        { clipPath: 'inset(16% 16% 16% 16% round 1.5rem)', scale: 1.06 },
        { clipPath: 'inset(0% 0% 0% 0% round 0.75rem)', scale: 1, duration: 1.3, ease: 'power4.out', scrollTrigger: trigger },
      )
      gsap.from(root.current.querySelectorAll('[data-fade]'), {
        y: 36, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, delay: 0.25, scrollTrigger: trigger,
      })
    }, root)
    return () => ctx.revert()
  }, [reduced])

  const hasLinks = project.liveUrl || project.sourceUrl || project.caseStudyUrl
  const linkClass = 'inline-flex items-center gap-1.5 text-sm font-semibold text-forest underline decoration-gold/60 underline-offset-4 transition-colors hover:text-forest/70 hover:decoration-mint'

  return (
    <article ref={root} className="group flex h-full flex-col">
      <div ref={frame}>
      <motion.div
        whileHover={reduced ? undefined : { y: -3 }}
        whileTap={reduced ? undefined : { scale: 0.995 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className={`relative overflow-hidden rounded-xl ring-1 ring-white/10 ${wide ? 'aspect-[4/5]' : 'aspect-[5/4]'}`}
      >
        <Preview project={project} />
        {project.isPlaceholder && (
          <span className="absolute top-3 left-3 rounded-full bg-ink/80 px-3 py-1 text-xs font-semibold text-sage backdrop-blur">
            Placeholder
          </span>
        )}
      </motion.div>
      </div>

      <div className="mt-6 flex flex-1 flex-col">
        <div data-fade className="flex items-baseline justify-between gap-4 border-t border-forest/15 pt-4">
          <p className="text-xs font-semibold tracking-[0.18em] text-mint uppercase">{project.category}</p>
          <span className="font-display text-sm text-mist">({number})</span>
        </div>
        <h3 data-fade className="mt-4 font-display text-[clamp(1.7rem,3vw,2.6rem)] leading-[1.02] font-semibold tracking-tight">{project.title}</h3>
        <p data-fade className="mt-3 max-w-md leading-relaxed text-forest/80">{project.description}</p>

        {project.tech.length > 0 && (
          <ul data-fade className="mt-4 flex flex-wrap gap-2" aria-label="Technologies used">
            {project.tech.map((t) => (
              <li key={t} className="rounded-full bg-soft-green px-3 py-1 text-xs font-medium text-forest">{t}</li>
            ))}
          </ul>
        )}

        <div data-fade className="mt-auto flex flex-wrap gap-x-5 gap-y-2 pt-5">
          {project.liveUrl && (
            <a href={project.liveUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              <ExternalLink className="size-4" aria-hidden="true" /> View Live Project
            </a>
          )}
          {project.sourceUrl && (
            <a href={project.sourceUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              <Code className="size-4" aria-hidden="true" /> View Source Code
            </a>
          )}
          {project.caseStudyUrl && (
            <a href={project.caseStudyUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              <BookOpen className="size-4" aria-hidden="true" /> View Case Study
            </a>
          )}
          {!hasLinks && <p className="text-sm text-mist">Links will appear here once added.</p>}
        </div>
      </div>
    </article>
  )
}
