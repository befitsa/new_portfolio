// src/hooks/useActiveSection.js
import { useEffect, useState } from 'react'

// Returns the id of the section currently crossing ~35% down the viewport.
// ids must be listed in the same order they appear on the page.
export function useActiveSection(ids) {
  const [active, setActive] = useState(ids[0])

  useEffect(() => {
    let raf = 0
    const calculate = () => {
      raf = 0
      const line = window.innerHeight * 0.35
      let current = null
      for (const id of ids) {
        const el = document.getElementById(id)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (rect.top <= line && rect.bottom > line) current = id
      }
      if (current) setActive(current)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(calculate)
    }
    calculate()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [ids])

  return active
}
