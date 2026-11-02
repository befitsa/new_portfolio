// src/components/common/SocialLinks.jsx
import { useEffect, useState } from 'react'
import { Mail, Globe } from 'lucide-react'
import { FaGithub, FaInstagram, FaLinkedinIn, FaTelegram } from 'react-icons/fa6'
import { usePortfolioProfile } from '../../context/PortfolioProfileContext.jsx'

// Lucide dropped brand logos, so GitHub/LinkedIn come from react-icons.
const icons = {
  github: FaGithub,
  linkedin: FaLinkedinIn,
  instagram: FaInstagram,
  telegram: FaTelegram,
  email: Mail,
}

function SocialLogo({ url, Icon, label }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  return url && !failed
    ? <img
        className="size-[1.15rem] object-contain"
        src={url}
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
      />
    : <Icon className="size-[1.1rem]" aria-hidden="true" aria-label={`${label} icon`} />
}

export default function SocialLinks({ orientation = 'horizontal', size = 'md', className = '', excludeEmail = false, includeCustom = false }) {
  const profile = usePortfolioProfile()
  const links = profile.socials.filter((social) => (
    social.url
    && (!excludeEmail || social.id !== 'email')
    && (includeCustom || !social.custom)
    && (/^https?:\/\//i.test(social.url) || (social.id === 'email' && /^mailto:/i.test(social.url)))
  )).map((social, index) => ({ social, index }))
    .sort((left, right) => (
      Number(right.social.id === 'email') - Number(left.social.id === 'email')
      || left.index - right.index
    ))
    .map(({ social }) => social)
  if (links.length === 0) return null

  const box = size === 'sm' ? 'size-9' : 'size-10 md:size-11'

  return (
    <ul
      className={`flex gap-3 ${orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap'} ${className}`}
      aria-label="Social links"
    >
      {links.map(({ id, label, url, logo }) => {
        const Icon = icons[id] || Globe
        const external = /^https?:\/\//i.test(url)
        return (
          <li key={id}>
            <a
              href={url}
              aria-label={label}
              title={label}
              {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className={`grid ${box} place-items-center rounded-full border border-forest/15 bg-paper text-forest shadow-sm transition duration-300 hover:-translate-y-0.5 hover:bg-forest hover:text-ivory hover:ring-forest`}
            >
              <SocialLogo url={logo?.url} Icon={Icon} label={label} />
            </a>
          </li>
        )
      })}
    </ul>
  )
}
