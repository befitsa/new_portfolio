// src/components/common/Portrait.jsx
// Shows your real photo from profile.portrait.src. If the file is missing (or
// fails to load) a polished placeholder appears instead — never a broken image,
// and never an invented face.
import { useState } from 'react'
import { profile } from '../../data/profile'

export default function Portrait({ className = '' }) {
  const [failed, setFailed] = useState(false)

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-forest ring-1 ring-ivory/10 ${className}`}>
      {failed ? (
        <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(80%_60%_at_50%_30%,#1c4a3d_0%,#102a24_70%)] p-6 text-center">
          <div>
            <p className="font-display text-7xl font-semibold text-mint md:text-8xl">{profile.monogram}</p>
            <p className="mt-4 text-sm leading-relaxed text-sage">
              Add your portrait at
              <br />
              <code className="text-ivory">public/images/profile.JPG</code>
            </p>
          </div>
        </div>
      ) : (
        <img
          src={profile.portrait.src}
          alt={profile.portrait.alt}
          width="800"
          height="1000"
          // object-cover + object-top crops without stretching, keeping the face in frame.
          className="absolute inset-0 size-full object-cover object-top"
          onError={() => setFailed(true)}
          fetchPriority="high"
        />
      )}
      {/* Soft bottom shade so the portrait sits into the dark page. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-linear-to-t from-ink/60 to-transparent" />
    </div>
  )
}
