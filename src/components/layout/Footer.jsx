// src/components/layout/Footer.jsx
import { useLayoutEffect, useRef } from 'react'
import { ArrowUp } from 'lucide-react'
import { navItems } from '../../data/profile'
import { usePortfolioProfile } from '../../context/PortfolioProfileContext.jsx'
import { scrollToId, scrollToTop } from '../../utils/scroll'
import SocialLinks from '../common/SocialLinks'
import BrandLink from '../common/BrandLink'
import AnimatedText from '../common/AnimatedText'
import { gsap } from '../../utils/gsap'
import { useReducedMotion } from '../../hooks/useReducedMotion'

export default function Footer() {
  const profile = usePortfolioProfile()
  const footerRef = useRef(null)
  const reduced = useReducedMotion()

  // Year is computed, so you never have to edit it again.
  const year = new Date().getFullYear()
  const links = navItems

  useLayoutEffect(() => {
    const footer = footerRef.current
    if (!footer || reduced) return undefined

    const ctx = gsap.context(() => {
      gsap.from('[data-footer-reveal]', {
        y: 24,
        opacity: 0,
        duration: 0.75,
        ease: 'power3.out',
        stagger: 0.12,
        scrollTrigger: { trigger: footer, start: 'top 88%', once: true },
      })
    }, footer)

    return () => ctx.revert()
  }, [reduced])

  return (
    <footer ref={footerRef} className="border-t border-forest/15 bg-cream/72 pt-16 pb-10">
      <div className="mx-auto flex max-w-[90rem] flex-col gap-8 px-5 md:gap-10 md:px-10">
        <div data-footer-reveal className="flex justify-end">
          <button
            type="button"
            onClick={scrollToTop}
            className="group inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-forest/20 px-4 py-2.5 text-sm font-medium text-forest transition-colors hover:border-forest hover:text-forest sm:px-5"
          >
            Back to Top
            <ArrowUp className="size-4 transition-transform duration-300 group-hover:-translate-y-0.5" aria-hidden="true" />
          </button>
        </div>

        <div data-footer-reveal className="flex justify-center">
          <SocialLinks
            size="md"
            includeCustom
            className="w-full max-w-[42rem] justify-center gap-2 sm:gap-3"
          />
        </div>

        <nav data-footer-reveal aria-label="Footer" className="flex justify-center">
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-1 sm:gap-x-8">
            {links.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  onClick={(e) => { e.preventDefault(); scrollToId(item.id) }}
                  className="inline-block py-2 text-forest/70 transition-colors hover:text-forest"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div data-footer-reveal className="flex justify-center">
          <div className="flex w-full max-w-96 flex-wrap items-center justify-center gap-3">
            <BrandLink
              href="#home"
              onClick={(event) => { event.preventDefault(); scrollToTop() }}
              ariaLabel="Fitsum — back to top"
              logoSize={48}
              className="text-forest"
            />
            <p className="whitespace-nowrap text-sm text-forest/65">{profile.title}</p>
          </div>
        </div>
      </div>

      {/* Giant wordmark: letters rise out of a mask as it scrolls into view */}
      <div className="mx-auto mt-16 max-w-[90rem] overflow-hidden px-5 md:px-10" aria-hidden="true">
        <AnimatedText
          as="p"
          mode="chars"
          text="FITSUM MESFIN"
          className="font-display text-center text-[clamp(1.8rem,9vw,12rem)] leading-[0.95] font-semibold tracking-tighter whitespace-nowrap text-forest/85 uppercase"
        />
      </div>

      <div data-footer-reveal className="mx-auto mt-14 flex max-w-[90rem] flex-col items-center gap-2 border-t border-forest/10 px-5 pt-6 pb-[calc(env(safe-area-inset-bottom,0px)+6rem)] text-center text-sm text-forest/60 md:flex-row md:justify-between md:px-10 md:pb-6">
        <p>© {year} {profile.name}. All rights reserved.</p>
        <p>{profile.title} based in {profile.location || 'Addis Ababa, Ethiopia'}</p>
      </div>
    </footer>
  )
}
