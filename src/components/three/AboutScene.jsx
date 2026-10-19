// src/components/three/AboutScene.jsx
// A calm piece for the About section: three tilted rings around a wireframe core.
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import SceneCanvas from './SceneCanvas'
import { SculptureLighting } from './AbstractSculpture'
import { useQuality } from '../../hooks/useQuality'
import { useReducedMotion } from '../../hooks/useReducedMotion'

function Rings({ animate }) {
  const a = useRef()
  const b = useRef()
  const c = useRef()
  useFrame((_, dt) => {
    if (!animate) return
    a.current.rotation.x += dt * 0.3
    b.current.rotation.y += dt * 0.4
    c.current.rotation.z += dt * 0.25
  })
  return (
    <Float speed={animate ? 1 : 0} floatIntensity={animate ? 0.4 : 0} rotationIntensity={0}>
      <mesh>
        <icosahedronGeometry args={[0.55, 1]} />
        <meshStandardMaterial color="#70d6a0" wireframe />
      </mesh>
      <mesh ref={a} rotation={[0.6, 0, 0]}>
        <torusGeometry args={[1.0, 0.035, 16, 96]} />
        <meshStandardMaterial color="#f6f3eb" roughness={0.35} metalness={0.2} />
      </mesh>
      <mesh ref={b} rotation={[0, 0.5, 0.4]}>
        <torusGeometry args={[1.4, 0.035, 16, 96]} />
        <meshStandardMaterial color="#1b4638" roughness={0.25} metalness={0.4} />
      </mesh>
      <mesh ref={c} rotation={[1.2, 0.2, 0]}>
        <torusGeometry args={[1.8, 0.02, 16, 128]} />
        <meshStandardMaterial color="#a6b6aa" roughness={0.3} metalness={0.3} />
      </mesh>
    </Float>
  )
}

export default function AboutScene({ fallback }) {
  const quality = useQuality()
  const reduced = useReducedMotion()
  return (
    <SceneCanvas
      className="size-full"
      fallback={fallback}
      camera={{ position: [0, 0, 6.5], fov: 34 }}
      dprMax={quality === 'high' ? 1.5 : 1.15}
    >
      <SculptureLighting />
      <Rings animate={!reduced} />
    </SceneCanvas>
  )
}
