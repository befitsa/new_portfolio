// src/components/sections/Opportunities.jsx
// Opportunity roles and resume card.
import { useLayoutEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { Check, Download } from 'lucide-react'
import { opportunityRoles } from '../../data/services'
import { useResumeStatus } from '../../hooks/useResumeStatus'
import { gsap } from '../../utils/gsap'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import SectionHeading from '../common/SectionHeading'
import Reveal from '../common/Reveal'
import Button from '../common/Button'
import Section from '../common/Section'

function ResumeCard() {
  const root = useRef(null)
  const { status, href, downloadName } = useResumeStatus()
  const ready = status === 'ready'
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    const card = root.current
    if (!card || reduced) return undefined
    const buttons = [...card.querySelectorAll('[data-resume-button]')]
    const enter = (event) => gsap.to(event.currentTarget, { y: -2, scale: 1.03, duration: 0.22, ease: 'power2.out', overwrite: true })
    const leave = (event) => gsap.to(event.currentTarget, { y: 0, scale: 1, duration: 0.28, ease: 'power2.out', overwrite: true })
    buttons.forEach((button) => {
      button.addEventListener('pointerenter', enter)
      button.addEventListener('pointerleave', leave)
      button.addEventListener('focus', enter)
      button.addEventListener('blur', leave)
    })
    return () => {
      buttons.forEach((button) => {
        button.removeEventListener('pointerenter', enter)
        button.removeEventListener('pointerleave', leave)
        button.removeEventListener('focus', enter)
        button.removeEventListener('blur', leave)
      })
      gsap.killTweensOf(buttons)
    }
  }, [reduced])

  return (
    <div ref={root}>
      <motion.div
        whileHover={reduced ? undefined : { scale: 1.03 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-3xl bg-[#e8eff1] p-8 text-[#171a1b] shadow-[0_22px_60px_rgba(38,47,52,0.09)] md:p-10"
      >
        <p data-opportunity-card-copy className="font-display text-3xl font-semibold md:text-4xl">Let’s work together</p>

        {/* Honest status: we only say "ready" if the file was actually found. */}
        <p data-opportunity-card-copy className="mt-4 flex items-center gap-2 text-[#394245]/80" role="status">
          {ready ? (
            <>
              <Check className="size-4 text-forest" aria-hidden="true" /> Resume ready to download
            </>
          ) : status === 'checking' ? (
            'Checking resume…'
          ) : status === 'error' ? (
            'Resume information is temporarily unavailable.'
          ) : (
            'No resume is currently available for download.'
          )}
        </p>
        <div data-opportunity-card-copy className="mt-8 flex flex-wrap gap-3">
          {ready ? (
            <Button data-resume-button href={href} icon={Download} variant="dark" download={downloadName} className="bg-black text-white shadow-[0_8px_20px_rgba(0,0,0,0.12)] hover:bg-[#1e2325] hover:text-white">
              Download Resume
            </Button>
          ) : (
            <Button data-resume-button icon={Download} variant="dark" disabled className="bg-black text-white">Download Resume</Button>
          )}
          <Button data-resume-button href="#contact" variant="dark" className="bg-black text-white shadow-[0_8px_20px_rgba(0,0,0,0.12)] hover:bg-[#1e2325] hover:text-white">Contact Me</Button>
        </div>
      </motion.div>
    </div>
  )
}

export default function Opportunities() {
  const root = useRef(null)
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    const section = root.current
    if (!section || reduced) return undefined

    let roleIndex = 0
    let roleDelay
    let roleTimeline

    const ctx = gsap.context(() => {
      const roleText = section.querySelector('[data-opportunity-role-text]')
      const cycleRole = () => {
        roleTimeline = gsap.timeline({
          onComplete: () => {
            roleDelay = gsap.delayedCall(1.8, cycleRole)
          },
        })
        roleTimeline
          .to(roleText, { y: -14, autoAlpha: 0, duration: 0.3, ease: 'power2.in' })
          .call(() => {
            roleIndex = (roleIndex + 1) % opportunityRoles.length
            roleText.textContent = opportunityRoles[roleIndex]
            gsap.set(roleText, { y: 14 })
          })
          .to(roleText, { y: 0, autoAlpha: 1, duration: 0.45, ease: 'power3.out' })
      }

      gsap.fromTo(
        roleText,
        { y: 18, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.75,
          ease: 'power3.out',
          onComplete: () => {
            roleDelay = gsap.delayedCall(1.8, cycleRole)
          },
          scrollTrigger: {
            trigger: section.querySelector('[aria-label="Available roles"]'),
            start: 'top 82%',
            once: true,
          },
        },
      )
      gsap.from('[data-opportunity-card-copy]', {
        y: 16,
        opacity: 0,
        duration: 0.65,
        ease: 'power3.out',
        stagger: 0.1,
        scrollTrigger: { trigger: section, start: 'top 60%', once: true },
      })
    }, section)

    return () => {
      ctx.revert()
      roleDelay?.kill()
      roleTimeline?.kill()
    }
  }, [reduced])

  return (
    <Section id="opportunities" ref={root} className="bg-[#000000] py-24 text-[#FFFFFF] md:py-32">
      <div className="mx-auto grid max-w-[90rem] gap-16 px-5 md:px-10 lg:grid-cols-12">
        <div className="lg:col-span-7 [&_h2]:!text-white [&_p]:!text-white">
          <SectionHeading
            compact
            className="[&_h2]:!text-[clamp(2.2rem,4vw,3.6rem)] [&_h2]:!font-bold"
            label="Open for opportunities"
            title={'Building scalable products\nwith purpose.'}
            description="I design and develop thoughtful digital experiences that solve real problems and grow with people."
          />

          <div className="mt-14 border-y border-white/15 py-5" role="group" aria-label="Available roles">
            <p className="sr-only">{`Available roles: ${opportunityRoles.join(', ')}`}</p>
            <div className="flex min-h-[1.25em] items-center gap-4">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[#FFFFFF]" />
              <span
                data-opportunity-role-text
                aria-hidden="true"
                className="whitespace-nowrap font-display text-[clamp(1.25rem,4.2vw,3.4rem)] font-semibold tracking-tight text-[#FFFFFF] uppercase"
              >
                {opportunityRoles[0]}
              </span>
            </div>
          </div>
        </div>

        <Reveal className="lg:col-span-5 lg:self-center" delay={0.1}>
          <ResumeCard />
        </Reveal>
      </div>
    </Section>
  )
}
