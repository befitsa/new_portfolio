// src/components/projects/ProjectCard.jsx
// One project preview and its compact title/platform details link.
import { lazy, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowUpRight } from 'lucide-react'
import { gsap } from '../../utils/gsap'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { projectDetailsPath } from '../../data/projects'
import LazyScene from '../three/LazyScene'

const ProjectScene = lazy(() => import('../three/ProjectScene'))

function projectPlatform(project) {
  const value = String(project.platform || project.category || '').toLowerCase()
  return /\bmobile\b|\bandroid\b|\bios\b/.test(value) ? 'Mobile' : 'Web'
}

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

export default function ProjectCard({ project }) {
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
        { clipPath: 'inset(16% 16% 16% 16% round 2rem)', scale: 1.06 },
        { clipPath: 'inset(0% 0% 0% 0% round 2rem)', scale: 1, duration: 1.3, ease: 'power4.out', scrollTrigger: trigger },
      )
      gsap.from(root.current.querySelectorAll('[data-fade]'), {
        y: 36, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, delay: 0.25, scrollTrigger: trigger,
      })
    }, root)
    return () => ctx.revert()
  }, [reduced])

  const platform = projectPlatform(project)

  return (
    <article ref={root} className="group relative flex h-full flex-col">
      <a
        href={projectDetailsPath(project)}
        aria-label={`View ${project.title} project details`}
        className="absolute inset-0 z-10 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mint"
      >
        <span className="sr-only">View project details</span>
      </a>
      <div ref={frame}>
      <motion.div
        whileHover={reduced ? undefined : { y: -3 }}
        whileTap={reduced ? undefined : { scale: 0.995 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="relative aspect-[4/3] overflow-hidden rounded-[2rem] ring-1 ring-white/10"
      >
        <Preview project={project} />
        {project.isPlaceholder && (
          <span className="absolute top-3 left-3 rounded-full bg-ink/80 px-3 py-1 text-xs font-semibold text-sage backdrop-blur">
            Placeholder
          </span>
        )}
      </motion.div>
      </div>

      <div className="mt-[15px] flex flex-1 flex-col">
        <div data-fade className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-display text-[15px] leading-snug font-bold text-ink sm:text-[16px] md:text-[17px] lg:text-[18px]">{project.title}</h3>
            <span className={`mt-[7px] inline-flex w-fit rounded-full px-3 py-[5px] text-xs leading-none font-semibold ${platform === 'Mobile' ? 'bg-[#DDF3DF] text-[#245B36]' : 'bg-[#DCEBFF] text-[#244A78]'}`}>
              {platform}
            </span>
          </div>
          <a
            href={projectDetailsPath(project)}
            aria-label={`View ${project.title} project details`}
            className="relative z-20 inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[#E8BA45] text-[#17251b] shadow-sm transition-transform hover:scale-105 hover:bg-[#F0C85A] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#E8BA45]"
          >
            <ArrowUpRight size={20} strokeWidth={2.2} aria-hidden="true" />
          </a>
        </div>
      </div>
    </article>
  )
}
