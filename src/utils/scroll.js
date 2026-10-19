// src/utils/scroll.js
// One shared place for scrolling, so Lenis (smooth scroll) and plain browser
// scrolling behave the same way for every link and button.

let lenis = null
export const setLenis = (instance) => { lenis = instance }
export const getLenis = () => lenis

// Height of the fixed navbar, so sections don't land underneath it.
export const NAV_OFFSET = 72

const prefersReduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function scrollToId(id) {
  const el = document.getElementById(id)
  if (!el) return
  const offset = id === 'home' ? 0 : -NAV_OFFSET

  if (lenis) {
    lenis.scrollTo(el, { offset, duration: 1.2 })
  } else {
    const top = el.getBoundingClientRect().top + window.scrollY + offset
    window.scrollTo({ top, behavior: prefersReduced() ? 'auto' : 'smooth' })
  }
  // replaceState keeps the URL shareable without filling the back-button history.
  window.history.replaceState(null, '', id === 'home' ? window.location.pathname : `#${id}`)
}

export function scrollToTop() {
  scrollToId('home')
}
