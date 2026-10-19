// src/components/common/AvailabilityBadge.jsx
// Green dot with a soft pulse + "Available for opportunities".
export default function AvailabilityBadge({ className = '' }) {
  return (
    <p className={`inline-flex items-center gap-2.5 text-sm text-forest ${className}`}>
      <span className="relative flex size-2.5" aria-hidden="true">
        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-mint" />
        <span className="relative size-2.5 rounded-full bg-mint" />
      </span>
      Available for opportunities
    </p>
  )
}
