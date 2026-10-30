// src/hooks/useSectionTransitions.js
// Desktop sections use the full stacked-card transition; tablets use a subtle
// transform reveal, while mobile and reduced-motion users keep native scrolling.
import { useLayoutEffect } from 'react'
import { gsap } from '../utils/gsap'
import { useReducedMotion } from './useReducedMotion'

export function useSectionTransitions() {
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    if (reduced) return undefined

    const ctx = gsap.context(() => {
      const media = gsap.matchMedia()
      const sections = () => gsap.utils.toArray('[data-section]')

      media.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
        sections().forEach((section, i, all) => {
          if (i === 0) return
          const prev = all[i - 1]
          const trigger = { trigger: section, start: 'top 100%', scrub: true }

          gsap.fromTo(
            section,
            { clipPath: 'inset(10vh 4vw 0vw 4vw round 2.5rem)' },
            { clipPath: 'inset(0vh 0vw 0vw 0vw round 0rem)', ease: 'none', scrollTrigger: { ...trigger, end: 'top 22%' } },
          )
          gsap.to(prev, {
            scale: 0.94,
            transformOrigin: '50% 100%',
            ease: 'none',
            scrollTrigger: { ...trigger, end: 'top 0%' },
          })
          gsap.to(prev.querySelector('[data-dim]'), {
            opacity: 0.08,
            ease: 'none',
            scrollTrigger: { ...trigger, end: 'top 0%' },
          })
        })
      })

      media.add('(min-width: 640px) and (max-width: 1023px) and (prefers-reduced-motion: no-preference)', () => {
        sections().slice(1).forEach((section) => {
          gsap.fromTo(
            section,
            { y: 10, opacity: 0.96 },
            {
              y: 0,
              opacity: 1,
              ease: 'none',
              scrollTrigger: {
                trigger: section,
                start: 'top 96%',
                end: 'top 55%',
                scrub: 0.5,
              },
            },
          )
        })
      })

      return () => media.revert()
    })

    return () => ctx.revert()
  }, [reduced])
}
