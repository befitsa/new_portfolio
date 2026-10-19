// src/hooks/useReducedMotion.js
import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

// True when the visitor's system asks for less motion. We use it to switch off
// parallax, smooth scrolling, marquee movement and 3D animation.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}
