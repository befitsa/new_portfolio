// src/hooks/useInView.js
import { useEffect, useState } from 'react'

// Tells us whether an element is on screen. 3D scenes use it to pause rendering
// while scrolled out of view, which saves battery and keeps scrolling smooth.
export function useInView(ref, { margin = '0px', once = false } = {}) {
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (!('IntersectionObserver' in window)) {
      setInView(true)
      return undefined
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting)
        if (entry.isIntersecting && once) io.disconnect()
      },
      { rootMargin: margin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, margin, once])

  return inView
}
