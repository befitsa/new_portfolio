export default function BrandLink({
  href = '/',
  onClick,
  className = '',
  ariaLabel = 'Fitsum — home',
  logoSize = 40,
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      aria-label={ariaLabel}
      className={`fitsum-brand ${className}`}
      style={{ '--fitsum-brand-logo-size': `${logoSize}px` }}
    >
      <img className="fitsum-brand-logo" src="/images/logo.png" alt="" width={logoSize} height={logoSize} />
      <span className="fitsum-brand-label">Fitsum</span>
    </a>
  )
}
