// src/components/sections/Hero.jsx
import { lazy, Suspense, useLayoutEffect, useMemo, useRef } from 'react'
import { motion } from 'motion/react'
import { profile } from '../../data/profile'
import { gsap, ScrollTrigger } from '../../utils/gsap'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import Button from '../common/Button'
import AnimatedText from '../common/AnimatedText'
import Portrait from '../common/Portrait'
import SocialLinks from '../common/SocialLinks'
import Section from '../common/Section'

const HeroParticleSphere = lazy(() => import('../three/HeroParticleSphere'))

const EASE = [0.22, 1, 0.36, 1]
const container = { hidden: {}, show: { transition: { staggerChildren: 0.1, delayChildren: 0.28 } } }
const item = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } } }

function ParticleSphereFallback() {
  const stars = useMemo(() => {
    const count = 180
    return Array.from({ length: count }, (_, i) => {
      const y = 1 - (i / (count - 1)) * 2
      const radius = Math.sqrt(1 - y * y)
      const angle = Math.PI * (3 - Math.sqrt(5)) * i
      return {
        left: `${50 + Math.cos(angle) * radius * 48}%`,
        top: `${50 + y * 48}%`,
        opacity: 0.2 + ((i * 17) % 7) * 0.075,
        size: i % 13 === 0 ? 2 : 1,
      }
    })
  }, [])

  return (
    <div aria-hidden="true" className="intro-sphere-fallback">
      {stars.map((star, index) => (
        <span
          key={index}
          className="intro-star"
          style={{ left: star.left, top: star.top, opacity: star.opacity, width: star.size, height: star.size }}
        />
      ))}
    </div>
  )
}

function HeroIntroduction() {
  return (
    <>
      <motion.p variants={item} className="mb-5 text-xs font-semibold tracking-[0.22em] text-forest uppercase">
        Thoughtful design · Purposeful code
      </motion.p>
      <AnimatedText
        as="p"
        mode="lines"
        trigger="load"
        text={profile.intro.split(' From ')[0]}
        className="max-w-lg font-display text-[clamp(1.65rem,3.1vw,2.8rem)] leading-[1.12] font-medium tracking-tight text-ink"
      />
      <motion.p variants={item} className="mt-5 max-w-md text-base leading-relaxed text-forest/80 md:text-lg">
        From {profile.intro.split(' From ')[1]}
      </motion.p>
      <motion.div variants={item} className="mt-8">
        <SocialLinks size="sm" />
      </motion.div>
    </>
  )
}

export default function Hero({ onIntroChange, skipIntro = false }) {
  const sectionRef = useRef(null)
  const titleRef = useRef(null)
  const heroRef = useRef(null)
  const heroNameRef = useRef(null)
  const introRef = useRef(null)
  const introPointerRef = useRef({
    x: 0,
    y: 0,
    directionX: 1,
    directionY: 0,
    strength: 0,
    previousX: null,
    previousY: null,
  })
  const introActive = useRef(true)
  const reduced = useReducedMotion()
  const showStaticIntro = reduced && !skipIntro
  const trackIntroPointer = (event) => {
    if (reduced || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')) return

    const bounds = event.currentTarget.getBoundingClientRect()
    const input = introPointerRef.current
    const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
    const y = 1 - ((event.clientY - bounds.top) / bounds.height) * 2

    if (input.previousX !== null && input.previousY !== null) {
      const deltaX = x - input.previousX
      const deltaY = y - input.previousY
      const distance = Math.hypot(deltaX, deltaY)
      if (distance > 0.0001) {
        input.directionX = deltaX / distance
        input.directionY = deltaY / distance
        input.strength = Math.min(0.85, Math.max(0.12, distance * 24))
      }
    }

    input.x = x
    input.y = y
    input.previousX = x
    input.previousY = y
  }
  const releaseIntroPointer = (event) => {
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
    introPointerRef.current.strength = 0
    introPointerRef.current.previousX = null
    introPointerRef.current.previousY = null
  }

  useLayoutEffect(() => {
    const section = sectionRef.current
    const title = titleRef.current
    const content = heroRef.current
    const heroName = heroNameRef.current
    const intro = introRef.current
    if (!section || !content || !heroName || (!reduced && !skipIntro && (!title || !intro))) return undefined

    if (showStaticIntro || skipIntro) {
      if (intro) gsap.set(intro, { autoAlpha: showStaticIntro ? 1 : 0 })
      gsap.set(content, { autoAlpha: 1 })
      gsap.set(heroName, { autoAlpha: 1 })
      introActive.current = showStaticIntro
      onIntroChange?.(showStaticIntro)
      if (showStaticIntro) {
        const ctx = gsap.context(() => {
          ScrollTrigger.create({
            trigger: intro,
            start: 'top top',
            end: 'bottom top',
            onLeave: () => {
              introActive.current = false
              onIntroChange?.(false)
            },
            onEnterBack: () => {
              introActive.current = true
              onIntroChange?.(true)
            },
          })
        }, section)
        return () => ctx.revert()
      }
      return undefined
    }

    const ctx = gsap.context(() => {
      const bounds = () => {
        const start = title.getBoundingClientRect()
        const end = heroName.getBoundingClientRect()
        const scaleX = end.width / start.width
        const scaleY = end.height / start.height
        return {
          x: end.left + end.width / 2 - (start.left + start.width / 2),
          y: end.top + end.height / 2 - (start.top + start.height / 2),
          scale: Math.min(scaleX, scaleY),
        }
      }

      gsap.fromTo(
        title,
        { filter: 'blur(10px)', opacity: 0.25 },
        { filter: 'blur(0px)', opacity: 1, duration: 1.35, ease: 'power4.out', delay: 0.15 },
      )

      const story = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: () => `+=${Math.round(window.innerHeight * (window.innerWidth < 768 ? 0.72 : 1))}`,
          pin: true,
          scrub: 0.8,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate(self) {
            const active = self.progress < 0.98
            if (introActive.current !== active) {
              introActive.current = active
              onIntroChange?.(active)
            }
          },
        },
      })

      story
        .to(intro, { autoAlpha: 0, duration: 0.7 }, 0.18)
        .to(title, { ...bounds(), duration: 0.72, ease: 'power2.inOut' }, 0.16)
        .to('[data-intro-kicker], [data-intro-footer]', { opacity: 0, y: -12, stagger: 0.06, duration: 0.28 }, 0.08)
        .to('[data-intro-sphere]', { scale: 1.12, opacity: 0, duration: 0.72 }, 0.18)
        .to(content, { autoAlpha: 1, duration: 0.42 }, 0.28)
        .to(heroName, { autoAlpha: 1, duration: 0.2 }, 0.72)
        .to(title, { opacity: 0, duration: 0.12 }, 0.82)

      gsap.from(section.querySelectorAll('[data-parallax]'), {
        y: 24,
        scrollTrigger: { trigger: section, start: 'top top', end: 'bottom top', scrub: true },
      })
    }, section)

    return () => {
      ctx.revert()
    }
  }, [reduced, showStaticIntro, skipIntro, onIntroChange])

  const initial = reduced ? false : 'hidden'

  return (
    <>
    <Section
      id="home"
      ref={sectionRef}
      className="relative isolate min-h-svh overflow-x-clip bg-cream"
    >
      <div
        ref={heroRef}
        style={showStaticIntro ? { minHeight: '200svh', paddingTop: '100svh' } : undefined}
        className={`hero-content relative z-10 flex min-h-svh items-center pt-[calc(env(safe-area-inset-top,0px)+1.5rem)] pb-10 md:pt-20 md:pb-16 ${reduced || skipIntro ? 'opacity-100 visible' : 'opacity-0 invisible'}`}
      >
        <div className="hero-grid mx-auto grid w-full max-w-[90rem] grid-cols-1 items-center gap-5 px-4 sm:gap-10 sm:px-6 md:px-10 lg:grid-cols-12 lg:gap-8">
          <motion.div
            className="hero-portrait order-1 mx-auto w-[min(68vw,16.5rem)] sm:w-full sm:max-w-[22rem] lg:order-2 lg:col-span-4 lg:max-w-none"
            variants={item}
            initial={initial}
            animate="show"
          >
            <div data-parallax="-4" className="relative mx-auto aspect-[4/5] max-w-[23rem]">
              <div aria-hidden="true" className="absolute inset-4 translate-x-3 translate-y-3 rounded-[2rem] border border-gold/45 bg-soft-green/50" />
              <div className="absolute inset-0 z-10 overflow-hidden rounded-[2rem] shadow-[0_24px_70px_rgba(22,74,58,0.16)]">
                <Portrait className="size-full rounded-[2rem]" />
              </div>
              <p className="absolute -bottom-1 left-1/2 z-30 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full border border-forest/10 bg-paper/90 px-4 py-2 text-center text-[0.65rem] font-semibold tracking-[0.16em] text-forest shadow-lg backdrop-blur sm:-bottom-5 sm:left-5 sm:w-auto sm:max-w-none sm:translate-x-0 sm:text-xs">
                FITSUM MESFIN · DEVELOPER
              </p>
            </div>
          </motion.div>

          <motion.div
            className="hero-identity order-2 mx-auto w-full max-w-xl text-center lg:order-3 lg:col-span-4 lg:mx-0 lg:max-w-none lg:pl-3 lg:text-left"
            variants={container}
            initial={initial}
            animate="show"
          >
            <motion.p variants={item} className="font-serif text-2xl text-gold italic md:text-3xl">Hello, I’m</motion.p>
            <h1
              ref={heroNameRef}
              data-hero-name
              className="invisible mt-2 whitespace-nowrap font-display text-[clamp(1.1rem,6.4vw,3.25rem)] leading-[0.92] font-semibold tracking-[-0.075em] text-ink sm:text-[clamp(2rem,7vw,3.5rem)] md:text-[clamp(1.1rem,4.2vw,2.25rem)] lg:text-[clamp(1.1rem,2.3vw,2.2rem)] lg:leading-[0.88]"
            >
              {profile.firstName} {profile.lastName}
            </h1>
            <motion.div variants={item} className="mt-5 flex flex-col justify-center gap-3 min-[23rem]:flex-row min-[23rem]:flex-wrap lg:justify-start">
              <Button href="#contact" size="md" arrow className="min-h-12 w-full min-[23rem]:w-auto min-[23rem]:px-5">Say Hello</Button>
              <Button href="#projects" variant="secondary" size="md" className="min-h-12 w-full border-forest/25 bg-forest px-5 text-white transition-colors hover:border-ink hover:bg-ink hover:text-black focus-visible:text-black min-[23rem]:w-auto">
                Explore My Work
              </Button>
            </motion.div>
            <motion.ul variants={item} className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm text-forest/75 lg:justify-start lg:text-base">
              {profile.roles.map((role) => (
                <li key={role} className="rounded-full border border-forest/15 bg-paper/70 px-3 py-1.5">{role}</li>
              ))}
            </motion.ul>
            <motion.p variants={item} className="mt-5 font-display text-base font-medium text-forest md:text-lg">
              {profile.title}
            </motion.p>
          </motion.div>

          <motion.div className="hero-intro order-3 mx-auto hidden w-full max-w-xl text-center md:block lg:order-1 lg:col-span-4 lg:mx-0 lg:max-w-none lg:text-left" variants={container} initial={initial} animate="show">
            <HeroIntroduction />
          </motion.div>
        </div>
      </div>

      <div
        ref={introRef}
        onPointerMove={trackIntroPointer}
        onPointerLeave={releaseIntroPointer}
        style={showStaticIntro ? { bottom: 'auto', height: '100svh' } : undefined}
        className="absolute inset-0 z-20 overflow-hidden bg-black text-white"
      >
          <div data-intro-sphere aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
            <Suspense fallback={<ParticleSphereFallback />}>
              <HeroParticleSphere fallback={<ParticleSphereFallback />} pointerRef={introPointerRef} />
            </Suspense>
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(ellipse_at_center,transparent_24%,rgba(0,0,0,0.28)_78%,#000_115%)]" />
          <p data-intro-kicker className="absolute top-[22%] left-[4vw] z-10 text-[0.6rem] font-medium tracking-[0.42em] text-white/55 uppercase md:top-[24%]">
            ( Creative developer & designer )
          </p>
          <div className="absolute inset-0 z-10 grid place-items-center px-5">
            <h2
              ref={titleRef}
              aria-label={`${profile.firstName} ${profile.lastName}`}
              className="w-full max-w-[calc(100vw-2rem)] whitespace-nowrap font-display text-[clamp(2.5rem,12vw,12rem)] leading-[0.82] font-semibold tracking-[-0.075em] text-center text-white md:text-[clamp(3.2rem,12.5vw,12rem)]"
            >
              <span className="intro-name-first">{profile.firstName.toUpperCase()}</span><br /><span className="intro-name-last relative block">{profile.lastName.toUpperCase()}</span>
            </h2>
          </div>
          <p data-intro-kicker className="absolute top-1/2 right-[4vw] z-10 hidden max-w-44 -translate-y-1/2 text-right text-sm leading-relaxed text-white/70 lg:block">
            Building thoughtful web and mobile experiences.
          </p>
          <div data-intro-footer className="absolute right-[3vw] bottom-8 left-[3vw] z-10 flex items-end justify-between border-t border-white/15 pt-5 text-[0.55rem] font-medium tracking-[0.34em] text-white/55 uppercase">
            <span>Developer & designer<br />Based in Ethiopia</span>
            <span className="animate-pulse text-white/65">Scroll to explore</span>
            <span>Portfolio ’26</span>
          </div>
      </div>

      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-20 -z-10 h-[34rem] bg-[radial-gradient(ellipse_at_center,rgba(221,232,216,0.78),transparent_67%)]" />
    </Section>
    <section aria-label="Introduction" className="mobile-hero-introduction border-t border-forest/10 bg-cream/70 px-4 py-12 md:hidden">
      <motion.div className="mx-auto w-full max-w-xl text-center" variants={container} initial={initial} animate="show">
        <HeroIntroduction />
      </motion.div>
    </section>
    </>
  )
}
