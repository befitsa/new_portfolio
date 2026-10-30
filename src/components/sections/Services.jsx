import { useLayoutEffect, useRef } from 'react'
import { Code, PenTool, Smartphone } from 'lucide-react'
import { serviceCards } from '../../data/services'
import { gsap } from '../../utils/gsap'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import Section from '../common/Section'
import SectionHeading from '../common/SectionHeading'

const icons = { code: Code, phone: Smartphone, pen: PenTool }

const surfaces = {
  frontend: 'bg-[#fffaf1]',
  mobile: 'bg-[#e9dfd0]',
  design: 'bg-[#f1e9dc]',
}

export default function Services() {
  const root = useRef(null)
  const stage = useRef(null)
  const cards = useRef([])
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    const section = root.current
    const stageElement = stage.current
    if (!section || !stageElement || reduced) return undefined

    const ctx = gsap.context(() => {
      const media = gsap.matchMedia()
      media.add('(min-width: 1024px)', () => {
        const cardElements = cards.current.filter(Boolean)
        if (cardElements.length < 2) return

        gsap.set(cardElements.slice(1), { yPercent: 112 })
        gsap.from(cardElements[0].querySelectorAll('[data-service-detail]'), {
          y: 24,
          opacity: 0,
          duration: 0.7,
          stagger: 0.1,
          ease: 'power3.out',
          scrollTrigger: { trigger: stageElement, start: 'top 72%', once: true },
        })

        const story = gsap.timeline({
          scrollTrigger: {
            trigger: stageElement,
            start: 'top 12%',
            end: () => `+=${Math.round(window.innerHeight * (cardElements.length - 1) * 0.85)}`,
            pin: true,
            pinReparent: true,
            scrub: 0.8,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        })

        cardElements.slice(1).forEach((card, index) => {
          const previous = cardElements[index]
          const beat = index
          story.to(previous, {
            y: -18,
            scale: 0.94,
            opacity: 0.62,
            duration: 1,
            ease: 'none',
          }, beat)
          story.to(card, {
            yPercent: 0,
            duration: 1,
            ease: 'none',
          }, beat)
          story.fromTo(
            card.querySelectorAll('[data-service-detail]'),
            { y: 22, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.5, stagger: 0.1, ease: 'power2.out' },
            beat + 0.28,
          )
        })
      })
      media.add('(max-width: 1023px)', () => {
        cards.current.filter(Boolean).forEach((card, index) => {
          gsap.from(card, {
            y: 12,
            opacity: 0,
            duration: 0.55,
            delay: Math.min(index * 0.04, 0.12),
            ease: 'power2.out',
            scrollTrigger: {
              trigger: card,
              start: 'top 90%',
              once: true,
            },
          })
        })
      })
      return () => media.revert()
    }, section)

    return () => ctx.revert()
  }, [reduced])

  return (
    <Section id="services" ref={root} className="bg-cream py-24 md:py-32">
      <div className="mx-auto max-w-[90rem] px-5 md:px-10">
        <SectionHeading
          label="Services"
          title="Thoughtful work, from idea to interface."
          description="Web, mobile, and user-centered design services drawn from the work I do."
        />

        <div
          ref={stage}
          className="service-stack-stage mt-14 space-y-5"
        >
          {serviceCards.map((card, index) => {
            const Icon = icons[card.icon]
            return (
              <article
                key={card.id}
                ref={(node) => { cards.current[index] = node }}
                data-service-card
                className={`service-stack-card relative flex min-h-[27rem] flex-col overflow-hidden rounded-[2rem] border border-[#33261d]/10 p-7 shadow-[0_24px_70px_rgba(49,39,29,0.1)] md:min-h-[23rem] md:p-10 lg:p-12 ${index === 0 ? 'bg-[#e8eff1]' : surfaces[card.id]}`}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1 right-8 z-0 select-none font-display text-[clamp(9rem,19vw,15rem)] leading-none font-bold tracking-[-0.08em] text-black/[0.07]"
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="relative z-10 flex items-center justify-between">
                  <span className={`grid size-12 place-items-center rounded-2xl ${index === 0 ? 'bg-black/5 text-[#171a1b]' : 'bg-[#31261f] text-[#fffaf1]'}`}>
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                </div>

                <div className="relative z-10 mt-8 grid gap-8 lg:mt-auto lg:grid-cols-12 lg:items-end">
                  <div className="lg:col-span-8">
                    <h3 data-service-detail className={`font-display text-[clamp(2.25rem,5vw,5.25rem)] leading-[0.98] font-semibold tracking-tight ${index === 0 ? 'text-[#171a1b]' : 'text-[#241c17]'}`}>
                      {card.title}
                    </h3>
                    <p data-service-detail className={`mt-5 max-w-2xl text-base leading-relaxed md:text-lg ${index === 0 ? 'text-[#333a3c]/85' : 'text-[#4d3d31]/85'}`}>
                      {card.description}
                    </p>
                  </div>
                  <ul data-service-detail className="flex flex-wrap gap-2 lg:col-span-4 lg:justify-end" aria-label={`${card.title} technologies`}>
                    {card.tech.map((tech) => (
                      <li key={tech} className="rounded-full border border-white/20 bg-black px-4 py-2 text-xs font-semibold text-white">
                        {tech}
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </Section>
  )
}
