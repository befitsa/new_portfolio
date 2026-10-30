// src/hooks/useReducedMotion.js
import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

// True when the visitor's system asks for less motion. We use it to switch off
// parallax, smooth scrolling, marquee movement and 3D animation.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(QUERY)?.matches),
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(QUERY)
    const onChange = () => setReduced(mq.matches)
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    mq.addListener(onChange)
    return () => mq.removeListener(onChange)
  }, [])
  return reduced
}
