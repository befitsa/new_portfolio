// src/components/common/Button.jsx
// One button for the whole site. Pass `href` to render a link, otherwise a <button>.
// Hash links ("#contact") use our smooth-scroll helper instead of the browser jump.
import { ArrowRight } from 'lucide-react'
import { scrollToId } from '../../utils/scroll'

const base =
  'group relative inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap ' +
  'transition-[background-color,color,border-color,transform] duration-300 active:scale-[0.97] ' +
  'aria-disabled:pointer-events-none aria-disabled:opacity-50 disabled:pointer-events-none disabled:opacity-50'

const variants = {
  primary: 'bg-mint text-ink hover:bg-ivory',
  secondary: 'border border-ivory/25 text-ivory hover:border-ivory/70 hover:bg-ivory/5',
  light: 'bg-ivory text-ink hover:bg-white',
  dark: 'bg-ink text-ivory hover:bg-forest',
  gold: 'bg-gradient-to-br from-[#e4c77f] via-[#c49a4e] to-[#9b6f2d] text-white shadow-[0_8px_22px_rgba(110,76,28,0.24)] hover:brightness-110 hover:text-white focus-visible:ring-2 focus-visible:ring-[#f3d88f] active:text-white',
  outlineDark: 'border border-ink/25 text-ink hover:border-ink hover:bg-ink/5',
}

const sizes = {
  sm: 'h-10 px-5 text-sm',
  md: 'h-12 px-6 text-sm',
  lg: 'h-14 px-8 text-base',
}

export default function Button({
  href,
  onClick,
  variant = 'primary',
  size = 'md',
  arrow = false,
  icon: Icon,
  className = '',
  children,
  ...rest
}) {
  const classes = `${base} ${variants[variant]} ${sizes[size]} ${className}`

  const content = (
    <>
      {Icon && <Icon className="size-4" aria-hidden="true" />}
      <span>{children}</span>
      {/* The arrow nudges right on hover — the "subtle motion" the brief asks for. */}
      {arrow && (
        <ArrowRight
          className="size-4 transition-transform duration-300 group-hover:translate-x-1"
          aria-hidden="true"
        />
      )}
    </>
  )

  if (href) {
    const isHash = href.startsWith('#')
    const isExternal = /^https?:\/\//.test(href)
    const handleClick = (event) => {
      if (isHash) {
        event.preventDefault()
        scrollToId(href.slice(1))
      }
      onClick?.(event)
    }
    return (
      <a
        href={href}
        onClick={handleClick}
        className={classes}
        {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        {...rest}
      >
        {content}
      </a>
    )
  }

  return (
    <button type="button" onClick={onClick} className={classes} {...rest}>
      {content}
    </button>
  )
}
