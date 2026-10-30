// src/components/sections/About.jsx
// Text-first editorial introduction followed by the thought section.
import { useLayoutEffect, useRef } from 'react'
import { gsap } from '../../utils/gsap'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { usePortfolioProfile } from '../../context/PortfolioProfileContext.jsx'
import Section from '../common/Section'
import SectionHeading from '../common/SectionHeading'
import AnimatedText from '../common/AnimatedText'

export default function About() {
  const profile = usePortfolioProfile()
  const aboutRoot = useRef(null)
  const thoughtStage = useRef(null)
  const thoughtTitle = useRef(null)
  const thoughtCopy = useRef(null)
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    if (reduced || !aboutRoot.current) return undefined

    const ctx = gsap.context(() => {
      gsap.from('[data-about-support]', {
        y: 24,
        opacity: 0,
        duration: 0.7,
        ease: 'power3.out',
        stagger: 0.13,
        scrollTrigger: { trigger: aboutRoot.current, start: 'top 74%', once: true },
      })
      if (thoughtStage.current && thoughtTitle.current && thoughtCopy.current) {
        const title = thoughtTitle.current
        const subheading = thoughtCopy.current.querySelector('[data-thought-reveal]')
        const reveal = gsap.timeline({
          scrollTrigger: {
            trigger: thoughtStage.current,
            start: 'top 78%',
            end: 'top 38%',
            scrub: 0.7,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        })

        reveal
          .fromTo(title,
            { y: 24, autoAlpha: 0.45 },
            { y: 0, autoAlpha: 1, ease: 'none', duration: 0.42 },
            0,
          )
        if (subheading) {
          gsap.fromTo(
            subheading,
            { y: 36, autoAlpha: 0.35 },
            {
              y: 0,
              autoAlpha: 1,
              duration: 0.9,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: subheading,
                start: 'top 84%',
                once: true,
              },
            },
          )
        }
      }
    }, aboutRoot.current)

    return () => ctx.revert()
  }, [reduced])

  return (
    <Section id="about" ref={aboutRoot} className="bg-cream py-24 md:py-32">
      <div className="mx-auto max-w-[90rem] px-5 md:px-10">
        <div className="grid items-center gap-12 lg:grid-cols-12">
          <div className="lg:col-span-10 lg:col-start-2">
            <SectionHeading
              label="About me"
              title={'Thoughtful design.\nPurposeful code.'}
            />
            {/* Words light up one by one as you scroll through the paragraph. */}
            <AnimatedText
              key={profile.about}
              as="p"
              mode="scrub"
              text={profile.about}
              className="mt-10 max-w-2xl font-display text-[clamp(1.35rem,2.4vw,2rem)] leading-snug text-ink"
            />
            <div className="mt-12 grid gap-8 border-t border-forest/15 pt-8 sm:grid-cols-3">
              {[
                ['01', 'User-centered', 'Clear interfaces built around real needs.', 'bg-[#E8F0E3]'],
                ['02', 'Purposeful', 'Thoughtful details that make the experience feel effortless.', 'bg-[#F0E5D8]'],
                ['03', 'Maintainable', 'Practical technology and scalable implementation.', 'bg-[#DCEAF5]'],
              ].map(([number, title, description, backgroundClass]) => (
                <div
                  key={number}
                  data-about-support
                  className={`h-full rounded-[30px] p-6 ${backgroundClass}`}
                >
                  <p className="text-xs font-semibold tracking-[0.2em] text-gold">{number}</p>
                  <h3 className="mt-3 font-display text-lg font-semibold text-ink">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-forest/75">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div ref={thoughtStage} className="mt-24 py-14 md:mt-32 md:py-20">
          <div className="mx-auto grid max-w-[90rem] items-start gap-10 md:grid-cols-12 md:gap-8 lg:gap-12">
            <div className="md:col-span-5">
              <h2
                ref={thoughtTitle}
                className="font-display text-[clamp(3rem,9vw,8.5rem)] leading-[0.92] font-semibold tracking-[-0.065em] text-ink text-balance"
              >
                The Thought Behind<br className="hidden sm:block" /> the Work
              </h2>
              <div ref={thoughtCopy} className="mt-8 md:mt-10">
                <h3 data-thought-reveal className="font-display text-[clamp(1.8rem,3.4vw,3.5rem)] leading-[1.05] font-medium tracking-tight text-forest">
                  Good software feels effortless for a reason.
                </h3>
              </div>
            </div>
            <div className="philosophy-card-wrap flex justify-center md:col-span-7 md:justify-start">
              <article className="philosophy-card flex min-h-[18rem] flex-col justify-center px-7 py-10 md:min-h-[20rem] md:px-9 lg:px-14 lg:py-14">
                <div className="mx-auto w-full max-w-4xl">
                  <p className="text-base leading-relaxed text-white md:text-lg">
                    I believe impactful digital products feel effortless because every detail has a reason to be there. Clear interfaces, thoughtful usability, and maintainable code turn complex ideas into useful experiences.
                  </p>
                  <p className="mt-8 border-l-2 border-white/60 pl-5 font-serif text-xl font-medium text-white italic md:text-2xl">
                    Purposeful design. Reliable technology. Room to grow.
                  </p>
                </div>
              </article>
            </div>
          </div>
        </div>

        {/* "Service" in the navbar scrolls here */}
      </div>
    </Section>
  )
}
