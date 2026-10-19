import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { skills } from '../../data/skills'
import { gsap } from '../../utils/gsap'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import SectionHeading from '../common/SectionHeading'
import Section from '../common/Section'

const INTERVAL = 3200

export default function Skills() {
  const root = useRef(null)
  const cards = useRef([])
  const context = useRef(null)
  const progress = useRef(null)
  const touchStart = useRef(null)
  const reduced = useReducedMotion()
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const activeRef = useRef(active)

  activeRef.current = active

  useLayoutEffect(() => {
    const section = root.current
    if (!section) return undefined

    const ctx = gsap.context(() => {}, section)
    context.current = ctx
    ctx.add('layoutCards', () => {
      const width = section.clientWidth
      const mobile = width < 640
      const cardWidth = Math.min(mobile ? width * 0.82 : 380, 380)
      const step = mobile ? cardWidth * 0.84 : Math.min(cardWidth * 0.78, width * 0.25)
      cards.current.forEach((card, index) => {
        if (!card) return
        let offset = index - activeRef.current
        if (offset > skills.length / 2) offset -= skills.length
        if (offset < -skills.length / 2) offset += skills.length
        const distance = Math.abs(offset)
        gsap.to(card, {
          x: offset * step,
          yPercent: -50,
          xPercent: -50,
          y: distance ? 10 + distance * 4 : 0,
          scale: distance === 0 ? 1 : distance === 1 ? 0.84 : 0.68,
          autoAlpha: distance > 2 ? 0 : distance === 0 ? 1 : distance === 1 ? 0.58 : 0.18,
          zIndex: skills.length - distance,
          duration: reduced ? 0 : 0.7,
          ease: 'power3.out',
          overwrite: true,
        })
      })
    })
    ctx.layoutCards()
    const observer = new ResizeObserver(() => ctx.layoutCards())
    observer.observe(section)

    return () => {
      observer.disconnect()
      ctx.revert()
      context.current = null
    }
  }, [reduced])

  useLayoutEffect(() => {
    context.current?.layoutCards()
  }, [active])

  useEffect(() => () => {
    gsap.killTweensOf(cards.current)
    gsap.killTweensOf(progress.current)
  }, [])

  useEffect(() => {
    if (reduced || paused) {
      gsap.killTweensOf(progress.current)
      return undefined
    }

    gsap.fromTo(progress.current, { scaleX: 0 }, { scaleX: 1, duration: INTERVAL / 1000, ease: 'none', overwrite: true })
    const timer = setTimeout(() => setActive((index) => (index + 1) % skills.length), INTERVAL)
    return () => {
      clearTimeout(timer)
      gsap.killTweensOf(progress.current)
    }
  }, [active, paused, reduced])

  const move = (step) => {
    setActive((index) => (index + step + skills.length) % skills.length)
  }

  const onWheel = (event) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
    event.preventDefault()
    move(event.deltaX > 0 ? 1 : -1)
  }

  const onTouchStart = (event) => {
    touchStart.current = event.changedTouches[0].clientX
    setPaused(true)
  }

  const onTouchEnd = (event) => {
    if (touchStart.current === null) return
    const delta = touchStart.current - event.changedTouches[0].clientX
    if (Math.abs(delta) > 35) move(delta > 0 ? 1 : -1)
    touchStart.current = null
    setPaused(false)
  }

  const selected = skills[active]

  return (
    <Section id="skills" className="overflow-hidden bg-cream py-24 md:py-32">
      <div className="mx-auto max-w-[90rem] px-5 md:px-10">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <SectionHeading label="Skills & tools" title="Tools I work with" />
          <p className="max-w-md pb-2 text-base text-forest/65 md:text-right">
            A growing toolkit for bringing meaningful digital ideas to life.
          </p>
        </div>

        <div
          ref={root}
          role="region"
          aria-label="Technology showcase"
          aria-roledescription="carousel"
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false)
          }}
          onWheel={onWheel}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          className="relative mx-auto mt-10 h-[24rem] max-w-6xl touch-pan-y overflow-hidden sm:h-[27rem] md:mt-8"
        >
          {skills.map(({ name, Icon, color }, index) => (
            <article
              key={name}
              ref={(node) => { cards.current[index] = node }}
              aria-hidden={index !== active}
              aria-label={`${name}, ${index + 1} of ${skills.length}`}
              className="absolute top-1/2 left-1/2 h-[19rem] w-[82%] max-w-[23.75rem] overflow-hidden rounded-[2rem] border border-white/80 bg-white/60 p-7 shadow-[0_25px_70px_rgba(63,58,45,0.12)] backdrop-blur-xl transition-[background-color,box-shadow,border-color] duration-300 hover:border-white hover:bg-white/75 hover:shadow-[0_30px_80px_rgba(63,58,45,0.16)] sm:h-[21rem] sm:p-9"
            >
              <div className="flex items-center justify-between text-[0.6rem] font-semibold tracking-[0.22em] text-forest/45 uppercase">
                <span>Technology</span>
                <span>{String(index + 1).padStart(2, '0')} / {String(skills.length).padStart(2, '0')}</span>
              </div>
              <div className="flex h-[13rem] flex-col items-center justify-center sm:h-[14.5rem]">
                <Icon className="size-[4.25rem] sm:size-[4.75rem]" style={{ color }} aria-hidden="true" />
                <h3 className="mt-5 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{name}</h3>
                <p className="mt-2 text-[0.62rem] font-semibold tracking-[0.22em] text-forest/50 uppercase">In my toolkit</p>
              </div>
              <div className="absolute right-8 bottom-7 left-8 h-1 overflow-hidden rounded-full bg-forest/10 sm:right-9 sm:left-9">
                <span
                  ref={index === active ? progress : undefined}
                  className="block h-full origin-left rounded-full bg-mint"
                  style={{ transform: 'scaleX(0)' }}
                />
              </div>
            </article>
          ))}
        </div>

        <p className="mt-2 text-center text-sm font-medium text-forest/70" aria-live="polite" aria-atomic="true">
          {String(active + 1).padStart(2, '0')} / {String(skills.length).padStart(2, '0')} · {selected.name}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2" aria-label="Choose a technology">
          {skills.map((skill, index) => (
            <button
              key={skill.name}
              type="button"
              aria-label={`Show ${skill.name}`}
              aria-current={index === active ? 'true' : undefined}
              onClick={() => setActive(index)}
              className={`h-2 rounded-full transition-[width,background-color] duration-300 ${index === active ? 'w-8 bg-forest' : 'w-2 bg-forest/20 hover:bg-forest/45'}`}
            />
          ))}
        </div>
        <p className="mt-5 text-center text-[0.62rem] font-semibold tracking-[0.2em] text-forest/40 uppercase">
          Auto cycles · swipe or use a horizontal trackpad
        </p>
      </div>
    </Section>
  )
}
