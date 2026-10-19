// src/components/three/SceneFallback.jsx
// Pure CSS stand-in used (1) while a 3D chunk downloads, and (2) when WebGL is
// unavailable. It mimics the layered sculpture so the layout never jumps or looks empty.
const layers = [
  { w: 100, c: 'bg-forest' },
  { w: 86, c: 'bg-ivory/90' },
  { w: 72, c: 'bg-[#16392f]' },
  { w: 58, c: 'bg-mint' },
  { w: 44, c: 'bg-forest' },
]

export default function SceneFallback({ className = '' }) {
  return (
    <div aria-hidden="true" className={`relative size-full ${className}`}>
      <div className="absolute inset-x-[18%] bottom-[14%] flex flex-col-reverse items-center gap-1.5">
        {layers.map((layer, i) => (
          <div
            key={layer.w}
            className={`h-4 rounded-md ring-1 ring-mint/15 md:h-5 ${layer.c}`}
            style={{ width: `${layer.w}%`, transform: `translateX(${(i % 2 ? 1 : -1) * 4}%)` }}
          />
        ))}
      </div>
    </div>
  )
}
