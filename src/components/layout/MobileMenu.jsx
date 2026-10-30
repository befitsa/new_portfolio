// src/components/layout/MobileMenu.jsx
import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { byPrefixAndName } from '../../lib/fontawesome'
import { navItems } from '../../data/profile'
import { scrollToId, scrollToTop } from '../../utils/scroll'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import BrandLink from '../common/BrandLink'

export default function MobileMenu({ open, onClose, onToggle, activeId }) {
  const reduced = useReducedMotion()
  const menuRef = useRef(null)
  const gridButtonRef = useRef(null)
  const activeItem = navItems.find((item) => item.id === activeId)
  const menuVariants = {
    hidden: { opacity: 0, y: reduced ? 0 : -12 },
    show: {
      opacity: 1,
      y: 0,
      transition: reduced
        ? { duration: 0 }
        : { duration: 0.25, delayChildren: 0.04, staggerChildren: 0.07 },
    },
  }
  const linkVariants = {
    hidden: { opacity: 0, y: reduced ? 0 : 12 },
    show: {
      opacity: 1,
      y: 0,
      transition: reduced ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
    },
  }

  useEffect(() => {
    if (!open) return undefined
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector('a')?.focus())
    return () => {
      cancelAnimationFrame(frame)
      gridButtonRef.current?.focus()
    }
  }, [open])

  const trapFocus = (event) => {
    if (event.key !== 'Tab') return
    const focusable = menuRef.current?.querySelectorAll('button:not([tabindex="-1"]), a[href]')
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const go = (id) => {
    onClose()
    setTimeout(() => scrollToId(id), 60)
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.button
              key="scrim"
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              aria-label="Close navigation menu"
              className="mobile-menu-layer fixed inset-0 z-40 bg-forest/20 backdrop-blur-[2px] md:hidden"
              initial={{ opacity: reduced ? 1 : 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: reduced ? 1 : 0 }}
              transition={{ duration: reduced ? 0 : 0.2 }}
              onClick={onClose}
            />
            <motion.div
              key="panel"
              id="mobile-menu"
              ref={menuRef}
              role="dialog"
              aria-modal="true"
              aria-label="Explore the portfolio"
              onKeyDown={trapFocus}
              className="mobile-menu-layer fixed inset-x-4 z-50 mx-auto w-auto max-w-sm overflow-y-auto rounded-3xl border border-white/70 bg-paper/95 px-5 py-4 shadow-[0_20px_70px_rgba(22,74,58,0.2)] ring-1 ring-forest/10 backdrop-blur-2xl md:hidden"
              style={{
                bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5.5rem)',
                maxHeight: 'calc(100dvh - env(safe-area-inset-bottom, 0px) - 7rem)',
              }}
              initial="hidden"
              animate="show"
              exit="hidden"
              variants={menuVariants}
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="font-display text-sm font-semibold tracking-wide text-forest/60">Explore</p>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close navigation menu"
                  className="grid size-11 place-items-center rounded-full text-forest transition-colors hover:bg-soft-green focus-visible:bg-soft-green"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              <nav aria-label="Mobile">
                <ul>
                  {navItems.map((item) => (
                    <motion.li key={item.id} variants={linkVariants} className="border-b border-forest/10 last:border-0">
                      <a
                        href={`#${item.id}`}
                        onClick={(event) => { event.preventDefault(); go(item.id) }}
                        aria-current={activeId === item.id ? 'page' : undefined}
                        className={`flex min-h-12 items-center justify-between rounded-xl px-3 font-display text-lg font-medium transition-colors focus-visible:bg-soft-green ${activeId === item.id ? 'bg-soft-green/65 text-forest' : 'text-forest/75 hover:bg-soft-green/45 hover:text-forest'}`}
                      >
                        {item.label}
                        {activeId === item.id && <span className="size-2 rounded-full bg-forest" aria-hidden="true" />}
                      </a>
                    </motion.li>
                  ))}
                </ul>
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div
        className="mobile-bottom-nav fixed inset-x-0 z-40 flex justify-center px-4 md:hidden"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
      >
        <nav
          aria-label="Mobile navigation"
          className="flex h-16 w-[min(22rem,calc(100vw-2rem))] items-center justify-between rounded-full border border-white/75 bg-paper/75 px-2 shadow-[0_12px_38px_rgba(22,74,58,0.18)] ring-1 ring-forest/10 backdrop-blur-2xl"
        >
          <button
            ref={gridButtonRef}
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={open ? 'mobile-menu' : undefined}
            aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
            className={`grid size-12 shrink-0 place-items-center rounded-full transition-[background-color,color,transform] duration-200 active:scale-95 ${open ? 'bg-forest text-white' : 'text-forest hover:bg-soft-green focus-visible:bg-soft-green'}`}
          >
            {open ? <X className="size-6" aria-hidden="true" /> : <FontAwesomeIcon icon={byPrefixAndName.fadt['grid-2']} className="size-6" aria-hidden="true" />}
          </button>
          <span aria-live="polite" className="min-w-0 flex-1 truncate px-3 text-center text-xs font-semibold text-forest/75">
            {activeItem?.label ?? 'Explore'}
          </span>
          <BrandLink
            href="#home"
            onClick={(event) => {
              event.preventDefault()
              onClose()
              setTimeout(scrollToTop, 60)
            }}
            ariaLabel="Fitsum — back to home"
            logoSize={28}
            className="fitsum-brand-mobile shrink-0 rounded-full border border-white bg-white/85 px-2 shadow-sm transition-transform duration-200 hover:scale-105 active:scale-95"
          />
        </nav>
      </div>
    </>
  )
}
