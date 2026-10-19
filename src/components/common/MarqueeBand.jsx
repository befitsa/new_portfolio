// src/components/common/MarqueeBand.jsx
// Giant scrolling type between sections (the bold "tour poster" look).
// It drifts on its own, speeds up and skews with your scroll speed,
// and flips direction when you scroll back up.
import { useLayoutEffect, useRef } from 'react'
import { gsap, ScrollTrigger } from '../../utils/gsap'
import { useReducedMotion } from '../../hooks/useReducedMotion'

export default function MarqueeBand({ words, outline = false, reverse = false, className = '' }) {
  const band = useRef(null)
  const track = useRef(null)
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    if (reduced) return undefined
    const base = reverse ? -1 : 1

    const ctx = gsap.context(() => {
      // The track holds the same content twice, so sliding it -50% loops with no visible jump.
      const tween = gsap.to(track.current, { xPercent: -50, duration: 40, ease: 'none', repeat: -1 })
      tween.totalTime(2000) // start deep inside the loop so it can also run backwards smoothly
      tween.timeScale(base)

      const skew = gsap.quickTo(track.current, 'skewX', { duration: 0.5, ease: 'power3.out' })
      let settle
      ScrollTrigger.create({
        trigger: band.current,
        start: 'top bottom',
        end: 'bottom top',
        onUpdate(self) {
          const v = self.getVelocity()
          tween.timeScale(base * self.direction * (1 + Math.min(Math.abs(v) / 220, 9)))
          skew(gsap.utils.clamp(-9, 9, -v / 260))
          clearTimeout(settle)
          settle = setTimeout(() => skew(0), 120) // straighten up when scrolling stops
        },
      })
    }, band)

    return () => ctx.revert()
  }, [reduced, reverse])

  const style = outline
    ? 'text-transparent [-webkit-text-stroke:2px_#164a3a]'
    : 'text-forest'

  return (
    <div ref={band} aria-hidden="true" className={`overflow-hidden py-6 md:py-10 ${className}`}>
      <div ref={track} className="flex w-max whitespace-nowrap will-change-transform">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center">
            {words.map((word) => (
              <span key={word} className="flex items-center">
                <span className={`font-display text-[clamp(4rem,13vw,11rem)] leading-none font-semibold tracking-tight uppercase ${style}`}>
                  {word}
                </span>
                <span className="mx-[3.5vw] size-[2.4vw] min-h-3 min-w-3 rounded-full bg-mint" />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
