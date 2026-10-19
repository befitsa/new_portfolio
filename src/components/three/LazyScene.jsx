// src/components/three/LazyScene.jsx
// Only mounts (and therefore only downloads) a 3D scene when its container is
// close to the viewport. Until then the lightweight CSS fallback is shown.
// Pass a React.lazy() component as `children`.
import { Suspense, useRef } from 'react'
import { useInView } from '../../hooks/useInView'
import SceneFallback from './SceneFallback'

export default function LazyScene({ children, className = '', margin = '300px' }) {
  const ref = useRef(null)
  const near = useInView(ref, { margin, once: true })
  return (
    <div ref={ref} className={className}>
      {near ? <Suspense fallback={<SceneFallback />}>{children}</Suspense> : <SceneFallback />}
    </div>
  )
}
