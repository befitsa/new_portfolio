// src/components/three/OpportunityScene.jsx
// A smaller version of the hero sculpture for the resume card's corner.
import SceneCanvas from './SceneCanvas'
import { AbstractSculpture, SculptureLighting } from './AbstractSculpture'
import { useQuality } from '../../hooks/useQuality'
import { useReducedMotion } from '../../hooks/useReducedMotion'

export default function OpportunityScene({ fallback }) {
  const quality = useQuality()
  const reduced = useReducedMotion()
  return (
    <SceneCanvas
      className="size-full"
      fallback={fallback}
      camera={{ position: [0, 0.3, 8], fov: 32 }}
      dprMax={quality === 'high' ? 1.5 : 1.15}
    >
      <SculptureLighting />
      <AbstractSculpture scale={0.78} quality={quality} animate={!reduced} shadows={false} sparkles={quality === 'high'} />
    </SceneCanvas>
  )
}
