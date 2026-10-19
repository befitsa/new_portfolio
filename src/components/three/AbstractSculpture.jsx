// src/components/three/AbstractSculpture.jsx
// The signature 3D object: a twisting tower of layered slabs (think UI -> logic ->
// systems stacked into one product) with a thin orbiting ring and a few particles.
// All real meshes, physical materials and lights — no CSS tricks.
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { ContactShadows, Environment, Float, Lightformer, RoundedBox, Sparkles } from '@react-three/drei'
import { MathUtils } from 'three'

// Each slab: width, color, and how glossy it is. Colors come from the site palette.
const SLABS = [
  { w: 2.6, color: '#1b4638', rough: 0.25, metal: 0.2 },
  { w: 2.3, color: '#f6f3eb', rough: 0.55, metal: 0 },
  { w: 2.0, color: '#16392f', rough: 0.2, metal: 0.3 },
  { w: 1.7, color: '#70d6a0', rough: 0.3, metal: 0.1, glow: true },
  { w: 1.4, color: '#1b4638', rough: 0.25, metal: 0.2 },
  { w: 1.1, color: '#f6f3eb', rough: 0.55, metal: 0 },
]

// Shared lights + a custom studio "environment" built from Lightformers.
// Built locally (not downloaded) so the scene works offline and loads instantly.
export function SculptureLighting() {
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 6, 4]} intensity={2.4} />
      <pointLight position={[-4, -1, 3]} intensity={30} distance={12} color="#70d6a0" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.5} position={[0, 5, -9]} scale={[12, 6, 1]} />
        <Lightformer form="ring" color="#70d6a0" intensity={4} position={[-6, 1, -2]} scale={4} rotation-y={Math.PI / 2} />
        <Lightformer intensity={1.5} color="#f6f3eb" position={[6, -1, 2]} scale={[8, 4, 1]} rotation-y={-Math.PI / 2} />
      </Environment>
    </>
  )
}

export function AbstractSculpture({
  quality = 'high',
  animate = true, // false = still pose (reduced motion)
  pointer, // ref from usePointerRef(); optional
  position = [0, 0, 0],
  scale = 1,
  shadows = true,
  sparkles = true,
}) {
  const root = useRef()
  const tower = useRef()
  const orbit = useRef()
  const intro = useRef(animate ? 0 : 1) // 0 -> 1 "settle into place" animation on load

  useFrame((state, dt) => {
    if (!root.current) return
    // Entrance: ease from 55% size to full size.
    intro.current = MathUtils.damp(intro.current, 1, 2.4, dt)
    const eased = 1 - Math.pow(1 - intro.current, 3)
    root.current.scale.setScalar(scale * (0.55 + 0.45 * eased))

    if (!animate) return
    const px = pointer?.current.x ?? 0
    const py = pointer?.current.y ?? 0
    // Slow idle spin + gentle lean toward the mouse. damp() smooths it so it never jerks.
    tower.current.rotation.y = MathUtils.damp(tower.current.rotation.y, state.clock.elapsedTime * 0.18 + px * 0.45, 3, dt)
    tower.current.rotation.x = MathUtils.damp(tower.current.rotation.x, -py * 0.15, 3, dt)
    orbit.current.rotation.z += dt * 0.6
  })

  return (
    <group ref={root} position={position}>
      <Float speed={animate ? 1.2 : 0} rotationIntensity={animate ? 0.15 : 0} floatIntensity={animate ? 0.5 : 0}>
        <group ref={tower}>
          {SLABS.map((slab, i) => (
            <RoundedBox
              key={slab.color + i}
              args={[slab.w, 0.3, slab.w]}
              radius={0.05}
              smoothness={3}
              position={[0, (i - 2.5) * 0.36, 0]}
              rotation={[0, i * 0.32, 0]}
            >
              <meshPhysicalMaterial
                color={slab.color}
                roughness={slab.rough}
                metalness={slab.metal}
                clearcoat={0.6}
                clearcoatRoughness={0.25}
                emissive={slab.glow ? '#70d6a0' : '#000000'}
                emissiveIntensity={slab.glow ? 0.35 : 0}
              />
            </RoundedBox>
          ))}
        </group>

        {/* Thin tilted ring with one small satellite orbiting it */}
        <group rotation={[0.9, 0.3, 0]}>
          <mesh>
            <torusGeometry args={[1.95, 0.012, 12, 128]} />
            <meshBasicMaterial color="#70d6a0" toneMapped={false} />
          </mesh>
          <group ref={orbit}>
            <mesh position={[1.95, 0, 0]}>
              <icosahedronGeometry args={[0.1, 1]} />
              <meshBasicMaterial color="#f6f3eb" toneMapped={false} />
            </mesh>
          </group>
        </group>
      </Float>

      {/* Soft grounded shadow. Only live-updating on capable devices, since it re-renders each frame. */}
      {shadows && (
        <ContactShadows
          position={[0, -1.55, 0]}
          opacity={0.5}
          scale={8}
          blur={2.6}
          far={3}
          resolution={256}
          frames={animate ? Infinity : 1}
          color="#000000"
        />
      )}

      {sparkles && (
        <Sparkles count={quality === 'high' ? 40 : 14} scale={[4.5, 4, 3]} size={2.2} speed={0.3} color="#70d6a0" opacity={0.7} />
      )}
    </group>
  )
}
