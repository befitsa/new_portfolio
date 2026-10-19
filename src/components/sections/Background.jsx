// src/components/sections/Background.jsx
// Education | Experience toggle with an animated timeline.
import { useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { education } from '../../data/education'
import { experience } from '../../data/experience'
import { gsap } from '../../utils/gsap'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import SectionHeading from '../common/SectionHeading'
import Reveal from '../common/Reveal'
import Section from '../common/Section'

// Timeline: a mint line draws itself down as you scroll, and each entry slides in from the side.
function Timeline({ items }) {
  const root = useRef(null)
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    if (reduced) return undefined
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '[data-line]',
        { scaleY: 0 },
        { scaleY: 1, ease: 'none', transformOrigin: 'top', scrollTrigger: { trigger: root.current, start: 'top 70%', end: 'bottom 60%', scrub: true } },
      )
      gsap.utils.toArray('[data-entry]').forEach((entry) => {
        gsap.from(entry, { x: -28, opacity: 0, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: entry, start: 'top 88%', once: true } })
      })
    }, root)
    return () => ctx.revert()
  }, [reduced, items])

  return (
    <ol ref={root} className="relative ml-1.5">
      <span aria-hidden="true" className="absolute top-0 bottom-0 left-0 w-px bg-forest/15" />
      <span aria-hidden="true" data-line className="absolute top-0 bottom-0 left-0 w-px bg-mint" />
      {items.map((entry) => (
        <li key={entry.id} data-entry className="relative pb-14 pl-8 last:pb-0 md:pl-12">
          <span aria-hidden="true" className="absolute top-2 -left-[5px] size-2.5 rounded-full bg-mint ring-4 ring-soft-green" />
          <p className="font-display text-sm font-medium text-forest">{entry.date}</p>
          <h3 className="mt-2 font-display text-[clamp(1.6rem,3vw,2.5rem)] leading-tight font-semibold">{entry.title}</h3>
          <p className="mt-1 text-forest/75">{entry.place}</p>
          {entry.description && <p className="mt-3 max-w-lg text-forest/75">{entry.description}</p>}
        </li>
      ))}
    </ol>
  )
}

const tabs = [
  { id: 'education', label: 'Education', items: education },
  { id: 'experience', label: 'Experience', items: experience },
]

export default function Background() {
  const [active, setActive] = useState('education')
  const reduced = useReducedMotion()
  const current = tabs.find((t) => t.id === active)

  // Arrow keys move between tabs (standard accessible tab behavior).
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const next = active === 'education' ? 'experience' : 'education'
    setActive(next)
    document.getElementById(`tab-${next}`)?.focus()
  }

  return (
    <Section id="background" className="bg-soft-green py-24 md:py-32">
      <div className="mx-auto grid max-w-[90rem] gap-14 px-5 md:px-10 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <SectionHeading
            label="Background"
            title="Professional journey"
            description="My personal journey — fueling growth through experience."
            className="lg:sticky lg:top-28"
          />
        </div>

        <div className="lg:col-span-7">
          <Reveal>
            <div role="tablist" aria-label="Background" onKeyDown={onKeyDown} className="inline-flex rounded-full bg-ink/60 p-1.5">
              {tabs.map((tab) => {
                const selected = tab.id === active
                return (
                  <button
                    key={tab.id}
                    id={`tab-${tab.id}`}
                    role="tab"
                    type="button"
                    aria-selected={selected}
                    aria-controls="background-panel"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActive(tab.id)}
                    className={`relative rounded-full px-6 py-2.5 text-sm font-semibold transition-colors ${selected ? 'text-ink' : 'text-sage hover:text-ivory'}`}
                  >
                    {selected && (
                      <motion.span
                        layoutId="background-tab"
                        className="absolute inset-0 rounded-full bg-mint"
                        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 34 }}
                      />
                    )}
                    <span className="relative">{tab.label}</span>
                  </button>
                )
              })}
            </div>
          </Reveal>

          <div id="background-panel" role="tabpanel" aria-labelledby={`tab-${active}`} className="mt-12 min-h-72">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, x: reduced ? 0 : 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: reduced ? 0 : -24 }}
                transition={{ duration: 0.3 }}
              >
                {current.items.length > 0 ? (
                  <Timeline items={current.items} />
                ) : (
                  // Empty state: friendly for visitors, with a hint for you while developing.
                  <div className="border-l border-dashed border-forest/20 py-4 pl-8">
                    <p className="font-display text-2xl font-semibold">Experience entries are on the way.</p>
                    <p className="mt-2 max-w-md text-forest/75">Check back soon for roles and projects as they are added.</p>
                    {import.meta.env.DEV && (
                      <p className="mt-4 text-sm text-mist">Dev note: add entries in src/data/experience.js</p>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </Section>
  )
}
