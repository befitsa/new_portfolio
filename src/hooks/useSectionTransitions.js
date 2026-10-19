// src/hooks/useSectionTransitions.js
// The "authentic transition" between sections, driven entirely by GSAP ScrollTrigger:
//   1. the NEXT section starts as a rounded, inset card and expands to full-bleed as it rises
//   2. the PREVIOUS section shrinks slightly and dims, as if the new one slides over it
// Everything is scrubbed: it follows the scrollbar exactly, forwards and backwards.
import { useLayoutEffect } from 'react'
import { gsap } from '../utils/gsap'
import { useReducedMotion } from './useReducedMotion'

export function useSectionTransitions() {
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    if (reduced) return undefined

    const ctx = gsap.context(() => {
      const sections = gsap.utils.toArray('[data-section]')

      sections.forEach((section, i) => {
        if (i === 0) return // the hero has nothing before it
        const prev = sections[i - 1]
        const trigger = { trigger: section, start: 'top 100%', scrub: true }

        // 1) incoming section: rounded inset card -> full-bleed
        gsap.fromTo(
          section,
          { clipPath: 'inset(10vh 4vw 0vw 4vw round 2.5rem)' },
          { clipPath: 'inset(0vh 0vw 0vw 0vw round 0rem)', ease: 'none', scrollTrigger: { ...trigger, end: 'top 22%' } },
        )

        // 2) outgoing section: recedes and dims
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

    return () => ctx.revert()
  }, [reduced])
}
