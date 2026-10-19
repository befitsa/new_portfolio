// src/components/common/AnimatedText.jsx
// GSAP SplitText animations. One component, three styles:
//   mode="lines"  each line slides up out of an invisible mask  (headings, paragraphs)
//   mode="chars"  every letter slides up out of the mask        (giant display type)
//   mode="scrub"  words fade from dim to bright AS YOU SCROLL   (statements, quotes)
// trigger="scroll" waits until the text enters the screen; trigger="load" plays immediately.
// autoSplit re-splits the text if the window is resized or fonts finish loading,
// so the line breaks always match what is on screen.
import { Fragment, useLayoutEffect, useRef } from 'react'
import { gsap, SplitText } from '../../utils/gsap'
import { useReducedMotion } from '../../hooks/useReducedMotion'

export default function AnimatedText({
  as: Tag = 'div',
  text,
  mode = 'lines',
  trigger = 'scroll',
  delay = 0,
  className = '',
  ...rest
}) {
  const ref = useRef(null)
  const reduced = useReducedMotion()
  const parts = String(text).split('\n') // "\n" becomes a deliberate line break

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || reduced) return undefined // reduced motion: plain, fully visible text

    const once = trigger === 'scroll' ? { trigger: el, start: 'top 88%', once: true } : undefined

    // gsap.context collects everything created inside, so one revert() cleans it all up.
    const ctx = gsap.context(() => {
      SplitText.create(el, {
        type: mode === 'scrub' ? 'words' : mode === 'chars' ? 'lines,chars' : 'lines',
        mask: mode === 'scrub' ? undefined : 'lines',
        autoSplit: true,
        onSplit(self) {
          if (mode === 'scrub') {
            return gsap.fromTo(
              self.words,
              { opacity: 0.16 },
              {
                opacity: 1,
                ease: 'none',
                stagger: 0.12,
                scrollTrigger: { trigger: el, start: 'top 82%', end: 'bottom 48%', scrub: true },
              },
            )
          }
          if (mode === 'chars') {
            return gsap.from(self.chars, {
              yPercent: 115,
              duration: 1.1,
              ease: 'power4.out',
              stagger: 0.03,
              delay,
              scrollTrigger: once,
            })
          }
          return gsap.from(self.lines, {
            yPercent: 110,
            duration: 1.1,
            ease: 'power4.out',
            stagger: 0.09,
            delay,
            scrollTrigger: once,
          })
        },
      })
    }, el)

    return () => ctx.revert()
  }, [mode, trigger, delay, reduced, text])

  return (
    <Tag ref={ref} className={className} {...rest}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {part}
        </Fragment>
      ))}
    </Tag>
  )
}
