// src/components/common/Section.jsx
// Every page section uses this wrapper. It marks the section for the transition
// system (hooks/useSectionTransitions.js) and adds a "dim" layer that darkens the
// section as the next one slides over it.
export default function Section({ id, className = '', children, ref, ...rest }) {
  return (
    <section id={id} ref={ref} data-section className={`relative isolate ${className}`} {...rest}>
      {children}
      <div data-dim aria-hidden="true" className="pointer-events-none absolute inset-0 z-[100] bg-forest opacity-0" />
    </section>
  )
}
