// src/components/common/SectionHeading.jsx
// Label + big display heading + optional description.
// The heading and description are animated with GSAP SplitText (see AnimatedText.jsx).
import Reveal from './Reveal'
import AnimatedText from './AnimatedText'

export default function SectionHeading({
  label,
  title,
  description,
  as: Tag = 'h2',
  compact = false, // smaller heading for narrow columns
  className = '',
}) {
  const size = compact ? 'text-[clamp(2rem,3.6vw,3.25rem)]' : 'text-[clamp(2.6rem,7vw,6.25rem)]'

  return (
    <div className={className}>
      {label && (
        <Reveal as="p" className="mb-6 flex items-center gap-3 text-xs font-semibold tracking-[0.22em] text-forest uppercase">
          <span aria-hidden="true" className="h-px w-10 bg-forest" />
          {label}
        </Reveal>
      )}
      <AnimatedText
        as={Tag}
        text={title}
        mode="lines"
        className={`font-display ${size} leading-[0.95] font-semibold tracking-tight text-balance text-ink`}
      />
      {description && (
        <AnimatedText
          as="p"
          text={description}
          mode="lines"
          delay={0.15}
          className="mt-7 max-w-xl text-base leading-relaxed text-forest/80 md:text-lg"
        />
      )}
    </div>
  )
}
