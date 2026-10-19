// src/components/common/SmoothScroll.jsx
// Lenis smooth scrolling, driven by GSAP's ticker so ScrollTrigger and Lenis
// share ONE animation loop (the officially recommended integration).
// Skipped entirely when the visitor prefers reduced motion. Touch devices keep
// their natural native scrolling (Lenis does not hijack touch by default).
import { useEffect } from 'react'
import Lenis from 'lenis'
import { gsap, ScrollTrigger } from '../../utils/gsap'
import { setLenis } from '../../utils/scroll'
import { useReducedMotion } from '../../hooks/useReducedMotion'

export default function SmoothScroll() {
  const reduced = useReducedMotion()

  useEffect(() => {
    if (reduced) return undefined

    const lenis = new Lenis({ duration: 1.1, smoothWheel: true })
    setLenis(lenis)

    const onScroll = () => ScrollTrigger.update()
    lenis.on('scroll', onScroll)

    const tick = (time) => lenis.raf(time * 1000) // GSAP time is seconds, Lenis wants ms
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)

    // Clean up completely so React StrictMode / hot reload never double-runs it.
    return () => {
      gsap.ticker.remove(tick)
      lenis.off('scroll', onScroll)
      lenis.destroy()
      setLenis(null)
    }
  }, [reduced])

  return null
}
