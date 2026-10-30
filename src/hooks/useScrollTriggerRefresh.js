import { useEffect } from 'react'
import { ScrollTrigger } from '../utils/gsap'

export function useScrollTriggerRefresh() {
  useEffect(() => {
    let disposed = false
    let frame = 0
    let timeout = 0

    const scheduleRefresh = () => {
      if (disposed) return
      window.clearTimeout(timeout)
      window.cancelAnimationFrame(frame)
      timeout = window.setTimeout(() => {
        frame = window.requestAnimationFrame(() => {
          if (!disposed) ScrollTrigger.refresh()
        })
      }, 120)
    }

    window.addEventListener('resize', scheduleRefresh, { passive: true })
    window.addEventListener('orientationchange', scheduleRefresh, { passive: true })
    window.addEventListener('pageshow', scheduleRefresh)
    window.visualViewport?.addEventListener('resize', scheduleRefresh, { passive: true })
    document.addEventListener('load', scheduleRefresh, true)
    document.fonts?.ready.then(scheduleRefresh)
    scheduleRefresh()

    return () => {
      disposed = true
      window.clearTimeout(timeout)
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', scheduleRefresh)
      window.removeEventListener('orientationchange', scheduleRefresh)
      window.removeEventListener('pageshow', scheduleRefresh)
      window.visualViewport?.removeEventListener('resize', scheduleRefresh)
      document.removeEventListener('load', scheduleRefresh, true)
    }
  }, [])
}
