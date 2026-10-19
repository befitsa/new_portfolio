// src/components/three/HeroScene.jsx
// The hero canvas. It overlays the portrait's lower-right corner (see Hero.jsx) and is purely
// decorative, so it never blocks text, selection or buttons.
import SceneCanvas from './SceneCanvas'
import { AbstractSculpture, SculptureLighting } from './AbstractSculpture'
import { useQuality } from '../../hooks/useQuality'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { usePointerRef } from '../../hooks/usePointerRef'

export default function HeroScene({ fallback }) {
  const quality = useQuality()
  const reduced = useReducedMotion()
  const pointer = usePointerRef(!reduced)

  return (
    <SceneCanvas
      className="size-full"
      fallback={fallback}
      camera={{ position: [0, 0.4, 8.6], fov: 32 }}
      dprMax={quality === 'high' ? 1.75 : 1.25}
    >
      <SculptureLighting />
      <AbstractSculpture
        position={[1.1, -1.5, 0]}
        scale={0.52}
        quality={quality}
        animate={!reduced}
        pointer={pointer}
        shadows={quality === 'high'}
      />
    </SceneCanvas>
  )
}
