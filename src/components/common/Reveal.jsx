// src/components/common/Reveal.jsx
// Small scroll-triggered entrance: fades in and rises a little, once.
// With reduced motion it renders a plain element, so content is always visible.
import { motion } from 'motion/react'
import { useReducedMotion } from '../../hooks/useReducedMotion'

export const EASE = [0.22, 1, 0.36, 1]

export default function Reveal({ as = 'div', delay = 0, y = 24, className = '', children, ...rest }) {
  const reduced = useReducedMotion()

  if (reduced) {
    const Tag = as
    return <Tag className={className} {...rest}>{children}</Tag>
  }

  const MotionTag = motion[as]
  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      // once: don't replay on scroll back; the negative margin waits until the element is properly in view.
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.8, delay, ease: EASE }}
      {...rest}
    >
      {children}
    </MotionTag>
  )
}
