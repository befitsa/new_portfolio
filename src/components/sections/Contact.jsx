// src/components/sections/Contact.jsx
// Contact form (validated, accessible, honest about delivery) + contact info.
import { useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useForm } from 'react-hook-form'
import { CircleAlert, LoaderCircle, Send } from 'lucide-react'
import { helpServices } from '../../data/services'
import { profile } from '../../data/profile'
import { gsap } from '../../utils/gsap'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { buildMailto, sendContactMessage } from '../../services/contactService'
import SectionHeading from '../common/SectionHeading'
import Reveal from '../common/Reveal'
import Button from '../common/Button'
import Section from '../common/Section'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const inputClass =
  'w-full rounded-xl border border-ink/10 bg-white px-4 py-3.5 text-ink placeholder:text-ink/45 shadow-sm transition-colors focus:border-[#a8c0c7] focus:ring-2 focus:ring-[#a8c0c7]/30 aria-[invalid=true]:border-[#c24132]'

// Label + control + error message, wired together for screen readers.
function Field({ id, label, error, children }) {
  return (
    <div data-contact-field>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-ink">{label}</label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-2 flex items-center gap-1.5 text-sm text-[#a12b20]">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" /> {error}
        </p>
      )}
    </div>
  )
}

// Spinning loader that fits the Button's `icon` slot.
const Spinner = ({ className = '', ...rest }) => <LoaderCircle className={`${className} animate-spin`} {...rest} />

function ContactForm() {
  const formRef = useRef(null)
  const reduced = useReducedMotion()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ mode: 'onTouched', defaultValues: { name: '', email: '', subject: '', message: '' } })
  const [result, setResult] = useState(null)

  useLayoutEffect(() => {
    const form = formRef.current
    if (!form || reduced) return undefined

    const ctx = gsap.context(() => {
      gsap.from(form.querySelectorAll('[data-contact-field], [data-contact-submit]'), {
        y: 22,
        opacity: 0,
        duration: 0.7,
        ease: 'power3.out',
        stagger: 0.1,
        scrollTrigger: { trigger: form, start: 'top 84%', once: true },
      })
    }, form)

    return () => ctx.revert()
  }, [reduced])

  const onSubmit = async (values) => {
    setResult(null)
    const outcome = await sendContactMessage(values)
    setResult({ ...outcome, values })
    if (outcome.status === 'sent') reset()
  }

  // Shared props that tie each input to its error text.
  const a11y = (name) => ({
    'aria-invalid': errors[name] ? 'true' : 'false',
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
  })

  return (
    <form ref={formRef} onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <Field id="name" label="Your name" error={errors.name?.message}>
        <input id="name" type="text" autoComplete="name" placeholder="Name" className={inputClass} {...a11y('name')}
          {...register('name', { required: 'Please enter your name.', minLength: { value: 2, message: 'Your name should be at least 2 characters.' } })} />
      </Field>

      <Field id="email" label="Your email" error={errors.email?.message}>
        <input id="email" type="email" autoComplete="email" placeholder="Your email address" className={inputClass} {...a11y('email')}
          {...register('email', { required: 'Please enter your email address.', pattern: { value: EMAIL_PATTERN, message: 'Enter a valid email, like name@example.com.' } })} />
      </Field>

      <Field id="subject" label="Subject" error={errors.subject?.message}>
        <input id="subject" type="text" placeholder="What would you like to talk about?" className={inputClass} {...a11y('subject')}
          {...register('subject', { required: 'Please add a subject.', minLength: { value: 3, message: 'The subject should be at least 3 characters.' } })} />
      </Field>

      <Field id="message" label="Your message" error={errors.message?.message}>
        <textarea id="message" rows={5} placeholder="Tell me a little about your project..." className={`${inputClass} resize-y`} {...a11y('message')}
          {...register('message', { required: 'Please write a message.', minLength: { value: 10, message: 'Please write at least 10 characters.' } })} />
      </Field>

      {/* disabled while sending = no double submissions */}
      <Button data-contact-submit type="submit" size="lg" variant="dark" icon={isSubmitting ? Spinner : Send} disabled={isSubmitting} className="mx-auto w-full max-w-sm bg-[#465c65] text-white shadow-[0_8px_22px_rgba(45,65,73,0.2)] transition-[background-color,color,border-color,transform,box-shadow] hover:-translate-y-0.5 hover:bg-[#344850] hover:text-white hover:shadow-[0_12px_26px_rgba(45,65,73,0.24)] focus-visible:ring-2 focus-visible:ring-[#465c65]">
        {isSubmitting ? 'Sending…' : 'Submit Request'}
      </Button>

      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            key={result.status}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role={result.status === 'sent' ? 'status' : 'alert'}
            className={`rounded-lg p-4 text-sm leading-relaxed ${result.status === 'sent' ? 'bg-white/75 text-ink' : 'bg-red-50 text-red-900'}`}
          >
            {result.status === 'sent' && <p>Thank you — your message was delivered. I’ll be in touch soon.</p>}
            {result.status === 'unconfigured' && (
              <>
                <p>This form isn’t connected to an email service yet, so <strong>nothing was sent</strong>. You can still reach me directly:</p>
                <Button href={buildMailto(profile.email, result.values)} variant="secondary" size="sm" className="mt-3">
                  Open my email app
                </Button>
              </>
            )}
            {result.status === 'error' && (
              <>
                <p><strong>Your message was not sent.</strong> {result.message} Please try again or email me directly.</p>
                <Button href={buildMailto(profile.email, result.values)} variant="secondary" size="sm" className="mt-3">
                  Open my email app
                </Button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  )
}

export default function Contact() {
  const invitation = useRef(null)
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    const card = invitation.current
    if (!card || reduced) return undefined

    const ctx = gsap.context(() => {
      const trigger = {
        trigger: card,
        start: 'top 82%',
        toggleActions: 'play none none reverse',
      }
      gsap.fromTo(
        card,
        { y: 34, scale: 0.97, opacity: 0, clipPath: 'inset(0 0 16% 0 round 2rem)' },
        { y: 0, scale: 1, opacity: 1, clipPath: 'inset(0 0 0 0 round 2rem)', duration: 0.9, ease: 'power3.out', scrollTrigger: trigger },
      )
      gsap.from(card.querySelectorAll('[data-invitation-copy]'), {
        y: 18,
        opacity: 0,
        duration: 0.7,
        ease: 'power3.out',
        stagger: 0.12,
        delay: 0.15,
        scrollTrigger: trigger,
      })
    }, card)

    return () => ctx.revert()
  }, [reduced])

  return (
    <Section id="contact" className="bg-cream py-24 md:py-32">
      <div className="mx-auto max-w-[90rem] px-5 md:px-10">
        <SectionHeading
          label="Let’s build"
          title="Something meaningful."
          description="Have a project in mind? I’d love to hear what you’re working on."
        />

        <div className="mt-16 grid gap-14 lg:grid-cols-12 lg:gap-12">
          {/* LEFT: form */}
          <Reveal className="lg:col-span-6">
            <div className="rounded-[30px_60px_60px_30px] bg-[#e8eff1] p-6 shadow-[0_26px_70px_rgba(75,85,90,0.12)] md:rounded-[30px_200px_200px_30px] md:p-10">
              <p className="text-xs font-semibold tracking-[0.22em] text-[#8b6a32] uppercase">Direct channel</p>
              <h3 className="mt-4 font-display text-3xl font-semibold text-ink">Send a message</h3>
              <p className="mt-3 mb-8 text-ink/65">Share a little about your idea and I’ll be in touch.</p>
              <ContactForm />
            </div>
          </Reveal>

          {/* RIGHT: info + services */}
          <div className="lg:col-span-6 lg:pl-8">
            <div ref={invitation} className="rounded-[2rem] border border-forest/10 bg-paper/75 p-7 shadow-[0_22px_60px_rgba(38,47,36,0.08)] md:p-9">
              <p data-invitation-copy className="text-xs font-semibold tracking-[0.22em] text-forest uppercase">Let’s create together</p>
              <h3 data-invitation-copy className="mt-4 font-display text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.05] font-semibold text-ink text-balance">
                Let’s build something great together.
              </h3>
              <p data-invitation-copy className="mt-5 max-w-lg text-forest/75">
                Need a website that feels modern and works flawlessly? Or systems that make your business easier to manage?
              </p>
              <p data-invitation-copy className="mt-3 max-w-lg text-forest/75">
                Thoughtful digital experiences, built with scalable technologies and a focus on what matters to your users.
              </p>
              <a
                data-invitation-copy
                href={`mailto:${profile.email}`}
                className="mt-6 inline-block font-display text-base text-forest underline decoration-gold/50 underline-offset-[6px] transition-colors hover:text-forest/75 lg:text-sm xl:text-2xl"
              >
                {profile.email}
              </a>
            </div>

            <Reveal className="mt-14">
              <p className="text-xs font-semibold tracking-[0.22em] text-forest uppercase">How I can help</p>
              <ol className="mt-5 divide-y divide-forest/10 border-y border-forest/10">
                {helpServices.map((s, i) => (
                  <Reveal as="li" key={s.number} delay={i * 0.08} y={18}>
                    <div className="grid grid-cols-[3rem_1fr] gap-x-2 py-6">
                      <span className="font-display text-sm font-medium text-forest">{s.number}</span>
                      <div>
                        <h4 className="font-display text-xl font-semibold">{s.title}</h4>
                        <p className="mt-2 text-forest/75">{s.description}</p>
                      </div>
                    </div>
                  </Reveal>
                ))}
              </ol>
            </Reveal>

            <Reveal as="blockquote" className="mt-14 font-serif text-2xl leading-snug text-forest italic md:text-3xl">
              “Let’s transform your ideas into reliable digital products that can scale and make a real impact.”
            </Reveal>
          </div>
        </div>
      </div>
    </Section>
  )
}
