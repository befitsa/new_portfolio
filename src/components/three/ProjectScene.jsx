// src/components/three/ProjectScene.jsx
// Small 3D previews for project cards. Interactive previews tilt toward the cursor.
// Two variants:
//   'orbit' - a wireframe core with three orbiting spheres
//   'stack' - three floating "screens", like an abstract app interface
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Float, RoundedBox } from '@react-three/drei'
import { MathUtils } from 'three'
import SceneCanvas from './SceneCanvas'
import { useReducedMotion } from '../../hooks/useReducedMotion'

// Shared helper: leans a group toward the pointer (R3F tracks it inside the canvas).
function useTilt(ref, animate, spin = 0) {
  const pointer = useThree((s) => s.pointer)
  useFrame((_, dt) => {
    const g = ref.current
    if (!g || !animate) return
    g.rotation.y = MathUtils.damp(g.rotation.y, pointer.x * 0.6, 4, dt) + dt * spin
    g.rotation.x = MathUtils.damp(g.rotation.x, -pointer.y * 0.4, 4, dt)
  })
}

function Orbit({ animate }) {
  const group = useRef()
  const rings = useRef()
  useTilt(group, animate, 0.25)
  useFrame((_, dt) => {
    if (animate) rings.current.rotation.y += dt * 0.8
  })
  return (
    <group ref={group}>
      <mesh>
        <icosahedronGeometry args={[0.85, 1]} />
        <meshStandardMaterial color="#1b4638" flatShading roughness={0.4} metalness={0.2} />
      </mesh>
      <mesh scale={1.03}>
        <icosahedronGeometry args={[0.85, 1]} />
        <meshBasicMaterial color="#70d6a0" wireframe transparent opacity={0.4} />
      </mesh>
      <group ref={rings} rotation={[0.5, 0, 0.3]}>
        {[0, 2.1, 4.2].map((angle) => (
          <mesh key={angle} position={[Math.cos(angle) * 1.55, Math.sin(angle) * 0.3, Math.sin(angle) * 1.55]}>
            <sphereGeometry args={[0.14, 20, 20]} />
            <meshStandardMaterial color={angle === 0 ? '#70d6a0' : '#f6f3eb'} roughness={0.3} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

function Screen({ position, rotation, color, accent }) {
  return (
    <group position={position} rotation={rotation}>
      <RoundedBox args={[2, 1.3, 0.06]} radius={0.06} smoothness={3}>
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.15} />
      </RoundedBox>
      {/* tiny boxes that read as a header bar, text lines and a button */}
      <mesh position={[-0.35, 0.42, 0.04]}><boxGeometry args={[1.0, 0.1, 0.02]} /><meshStandardMaterial color={accent} /></mesh>
      <mesh position={[-0.2, 0.12, 0.04]}><boxGeometry args={[1.4, 0.06, 0.02]} /><meshStandardMaterial color="#a6b6aa" /></mesh>
      <mesh position={[-0.3, -0.02, 0.04]}><boxGeometry args={[1.2, 0.06, 0.02]} /><meshStandardMaterial color="#a6b6aa" /></mesh>
      <mesh position={[-0.55, -0.4, 0.04]}><boxGeometry args={[0.6, 0.22, 0.02]} /><meshStandardMaterial color="#70d6a0" /></mesh>
    </group>
  )
}

function Stack({ animate }) {
  const group = useRef()
  useTilt(group, animate)
  return (
    <Float speed={animate ? 1.4 : 0} floatIntensity={animate ? 0.5 : 0} rotationIntensity={0}>
      <group ref={group}>
        <Screen position={[-0.5, 0.25, -0.7]} rotation={[0, 0.35, 0]} color="#16392f" accent="#a6b6aa" />
        <Screen position={[0, 0, 0]} rotation={[0, 0, 0]} color="#f6f3eb" accent="#102a24" />
        <Screen position={[0.55, -0.25, 0.7]} rotation={[0, -0.35, 0]} color="#1b4638" accent="#70d6a0" />
      </group>
    </Float>
  )
}

export default function ProjectScene({ variant = 'orbit', interactive = true, fallback }) {
  const reduced = useReducedMotion()
  return (
    <SceneCanvas className="size-full" fallback={fallback} camera={{ position: [0, 0, 5.4], fov: 35 }} dprMax={1.5}>
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 4, 5]} intensity={2.2} />
      <pointLight position={[-3, -1, 3]} intensity={18} distance={10} color="#70d6a0" />
      {variant === 'stack' ? <Stack animate={!reduced} /> : <Orbit animate={!reduced && interactive} />}
    </SceneCanvas>
  )
}
