// src/components/three/SceneCanvas.jsx
// Wrapper around R3F's <Canvas> that adds everything every scene needs:
//   - no WebGL?            -> show the CSS fallback
//   - scrolled off screen? -> stop rendering (frameloop "never")
//   - reduced motion?      -> render on demand only (a still image, no loop)
//   - scene crashes?       -> error boundary shows the fallback, page keeps working
import { Component, Suspense, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { useInView } from '../../hooks/useInView'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { hasWebGL } from '../../utils/webgl'
import SceneFallback from './SceneFallback'

class SceneBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export default function SceneCanvas({
  children,
  className = '',
  camera = { position: [0, 0, 8], fov: 32 },
  dprMax = 1.5,
  shadows = false,
  fallback = <SceneFallback />,
}) {
  const ref = useRef(null)
  const inView = useInView(ref, { margin: '200px' })
  const reduced = useReducedMotion()
  const supported = useMemo(hasWebGL, [])

  return (
    <div ref={ref} className={className}>
      {supported ? (
        <SceneBoundary fallback={fallback}>
          <Canvas
            frameloop={reduced ? 'demand' : inView ? 'always' : 'never'}
            // Cap the pixel ratio: rendering 3x pixels on phones costs a lot and is barely visible.
            dpr={[1, dprMax]}
            camera={camera}
            shadows={shadows}
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          >
            <Suspense fallback={null}>{children}</Suspense>
          </Canvas>
        </SceneBoundary>
      ) : (
        fallback
      )}
    </div>
  )
}
