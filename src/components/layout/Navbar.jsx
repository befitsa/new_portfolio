// src/components/layout/Navbar.jsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { navItems, profile } from '../../data/profile'
import { getLenis, scrollToId, scrollToTop } from '../../utils/scroll'
import { gsap } from '../../utils/gsap'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import Button from '../common/Button'
import MobileMenu from './MobileMenu'

const navListVariants = {
  hidden: {},
  show: { transition: { delayChildren: 0.18, staggerChildren: 0.055 } },
}

const navItemVariants = {
  hidden: { opacity: 0, y: -8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
}

export default function Navbar({ activeId, introActive = false }) {
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()
  const contactButton = useRef(null)

  useLayoutEffect(() => () => gsap.killTweensOf(contactButton.current), [])

  // While the mobile menu is open: lock page scroll, close on Escape,
  // and close automatically if the window grows to desktop width.
  useEffect(() => {
    if (!open) return undefined
    getLenis()?.stop()
    document.body.style.overflow = 'hidden'
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    const mq = window.matchMedia('(min-width: 768px) and (min-height: 501px)')
    const onResize = () => mq.matches && setOpen(false)
    window.addEventListener('keydown', onKey)
    mq.addEventListener('change', onResize)
    return () => {
      getLenis()?.start()
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
      mq.removeEventListener('change', onResize)
    }
  }, [open])

  return (
    <>
      <motion.header
        initial={reduced ? false : { opacity: 0, y: -16 }}
        animate={{ opacity: introActive ? 0 : 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        aria-hidden={introActive}
        className={`desktop-top-nav pointer-events-none fixed inset-x-0 top-0 z-50 hidden md:block ${introActive ? 'invisible' : ''}`}
      >
        <div className="pointer-events-auto mx-auto flex h-20 max-w-[100rem] items-center justify-between gap-4 px-5 md:grid md:grid-cols-[1fr_auto_1fr] md:px-8">
          {/* Logo: returns to the top */}
          <a
            href="#home"
            onClick={(e) => { e.preventDefault(); scrollToTop() }}
            aria-label={`${profile.name} — back to top`}
            className="grid size-11 place-items-center justify-self-start font-display text-xl font-bold tracking-tight text-forest"
          >
            <img src="/images/logo.png" alt="" width="40" height="40" className="size-10 object-contain" />
          </a>

          {/* Center links (desktop / tablet) */}
          <nav aria-label="Primary" className="hidden md:block">
            <motion.ul
              initial={reduced ? false : 'hidden'}
              animate="show"
              variants={navListVariants}
              className="flex items-center gap-0 rounded-full border border-white/70 bg-paper/75 p-1 shadow-[0_12px_42px_rgba(38,55,44,0.12)] ring-1 ring-forest/5 backdrop-blur-xl lg:gap-1 lg:p-1.5"
            >
              {navItems.map((item) => {
                const active = activeId === item.id
                return (
                  <motion.li key={item.id} variants={navItemVariants}>
                    <a
                      href={`#${item.id}`}
                      onClick={(e) => { e.preventDefault(); scrollToId(item.id) }}
                      aria-current={active ? 'true' : undefined}
                      className={`relative flex min-h-11 items-center rounded-full px-2 py-2 text-xs font-semibold transition-colors duration-300 lg:px-4 lg:text-sm ${active ? 'text-forest' : 'text-forest/65 hover:text-forest'}`}
                    >
                      {/* Shared layoutId makes this pill glide between links. */}
                      {active && (
                        <motion.span
                          layoutId="nav-pill"
                          className="absolute inset-0 rounded-full bg-soft-green/75"
                          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }}
                        />
                      )}
                      <span className="relative">{item.label}</span>
                    </a>
                  </motion.li>
                )
              })}
            </motion.ul>
          </nav>

          {/* Contact action */}
          <div className="justify-self-end">
            <Button
              ref={contactButton}
              href="#contact"
              arrow
              size="sm"
              variant="outlineDark"
              className="min-h-11 border border-transparent bg-[#DCEAF5] text-black transition-colors duration-300 hover:border-black hover:bg-white hover:text-black focus-visible:border-black focus-visible:bg-white focus-visible:text-black"
              onPointerEnter={() => !reduced && gsap.to(contactButton.current, { y: -2, scale: 1.025, duration: 0.25, ease: 'power2.out' })}
              onPointerLeave={() => !reduced && gsap.to(contactButton.current, { y: 0, scale: 1, duration: 0.3, ease: 'power2.out' })}
            >
              Contact Me
            </Button>
          </div>
        </div>
      </motion.header>

      <MobileMenu
        open={open}
        onClose={() => setOpen(false)}
        onToggle={() => setOpen((value) => !value)}
        activeId={activeId}
      />
    </>
  )
}
