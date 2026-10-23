// src/components/common/SocialLinks.jsx
// Renders only the links that have a real URL in src/data/profile.js.
import { Mail, Globe } from 'lucide-react'
import { FaGithub, FaLinkedinIn } from 'react-icons/fa6'
import { usePortfolioProfile } from '../../context/PortfolioProfileContext.jsx'

// Lucide dropped brand logos, so GitHub/LinkedIn come from react-icons.
const icons = { github: FaGithub, linkedin: FaLinkedinIn, email: Mail }

export default function SocialLinks({ orientation = 'horizontal', size = 'md', className = '' }) {
  const profile = usePortfolioProfile()
  const links = profile.socials.filter((s) => s.url)
  if (links.length === 0) return null

  const box = size === 'sm' ? 'size-9' : 'size-10 md:size-11'

  return (
    <ul
      className={`flex gap-3 ${orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap'} ${className}`}
      aria-label="Social links"
    >
      {links.map(({ id, label, url }) => {
        const Icon = icons[id] || Globe
        const external = /^https?:\/\//.test(url)
        return (
          <li key={id}>
            <a
              href={url}
              aria-label={label}
              title={label}
              {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className={`grid ${box} place-items-center rounded-full border border-forest/15 bg-paper text-forest shadow-sm transition duration-300 hover:-translate-y-0.5 hover:bg-forest hover:text-ivory hover:ring-forest`}
            >
              <Icon className="size-[1.1rem]" aria-hidden="true" />
            </a>
          </li>
        )
      })}
    </ul>
  )
}
