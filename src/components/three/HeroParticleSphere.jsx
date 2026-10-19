import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Vector2 } from 'three'
import { useQuality } from '../../hooks/useQuality'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import SceneCanvas from './SceneCanvas'

const vertexShader = `
  uniform float uTime;
  uniform vec2 uMousePosition;
  uniform vec2 uMouseDirection;
  uniform float uMouseStrength;
  attribute float aPhase;
  attribute float aSize;
  attribute float aBrightness;
  varying float vBrightness;

  void main() {
    vec3 direction = normalize(position);
    float waveA = sin(uTime * 0.34 + aPhase) * 0.02;
    float waveB = sin(uTime * 0.23 + aPhase * 1.71 + direction.x * 2.2 + direction.z * 1.3) * 0.014;
    float waveC = cos(uTime * 0.17 + aPhase * 0.83 + direction.y * 2.4 - direction.x * 1.5) * 0.01;
    float waveDown = sin(direction.y * 7.0 + uTime * 0.86 + aPhase * 0.22) * 0.018
      + sin(direction.y * 11.0 + uTime * 0.62 + aPhase * 0.12) * 0.006;
    float waveLeft = sin(direction.x * 8.0 + uTime * 0.76 + aPhase * 0.18) * 0.018
      + sin(direction.x * 12.0 + uTime * 0.56 + aPhase * 0.1) * 0.006;
    vec2 mouseOffset = direction.xy - uMousePosition * 0.82;
    float mouseField = exp(-dot(mouseOffset, mouseOffset) * 4.0);
    vec2 mouseDirection = normalize(uMouseDirection + vec2(0.0001));
    float mouseWave = sin(dot(direction.xy, mouseDirection) * 10.0 - uTime * 2.1 + aPhase * 0.15) * 0.035;
    vec3 axisA = normalize(vec3(0.71, 0.42, -0.56));
    vec3 axisB = normalize(vec3(-0.29, 0.86, 0.41));
    vec3 tangentA = normalize(axisA - direction * dot(axisA, direction));
    vec3 tangentB = normalize(axisB - direction * dot(axisB, direction));
    vec3 mouseAxis = normalize(vec3(mouseDirection.x, -mouseDirection.y, 0.15));
    vec3 mouseTangent = normalize(mouseAxis - direction * dot(mouseAxis, direction));
    float driftA = sin(uTime * 0.19 + aPhase * 1.23) * 0.009;
    float driftB = cos(uTime * 0.14 + aPhase * 0.79) * 0.007;
    vec3 displaced = position
      + direction * (waveA + waveB + waveC + waveDown + waveLeft)
      + tangentA * driftA
      + tangentB * driftB
      + mouseTangent * mouseWave * uMouseStrength * (0.35 + mouseField)
      + direction * mouseField * 0.025 * uMouseStrength;

    vec4 viewPosition = modelViewMatrix * vec4(displaced, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(aSize * (360.0 / -viewPosition.z), 2.2, 6.5);
    vBrightness = aBrightness * (0.95 + 0.05 * sin(uTime * 0.3 + aPhase));
  }
`

const fragmentShader = `
  varying float vBrightness;

  void main() {
    float distanceFromCenter = length(gl_PointCoord - vec2(0.5));
    float core = 1.0 - smoothstep(0.29, 0.46, distanceFromCenter);
    float halo = (1.0 - smoothstep(0.34, 0.5, distanceFromCenter)) * 0.075;
    gl_FragColor = vec4(vec3(0.9, 0.91, 0.94), (core * 0.63 + halo) * vBrightness);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function ParticleField({ count, animate, pointerRef }) {
  const group = useRef(null)
  const material = useRef(null)
  const { viewport } = useThree()
  const sphereRadius = Math.min(2.28, viewport.width * 0.46, viewport.height * 0.44)
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const phases = new Float32Array(count)
    const sizes = new Float32Array(count)
    const brightness = new Float32Array(count)
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))

    for (let i = 0; i < count; i += 1) {
      const y = 1 - (i / (count - 1)) * 2
      const radius = Math.sqrt(1 - y * y)
      const angle = goldenAngle * i
      const index = i * 3
      positions[index] = Math.cos(angle) * radius
      positions[index + 1] = y
      positions[index + 2] = Math.sin(angle) * radius
      phases[i] = (i * 2.399) % (Math.PI * 2)
      sizes[i] = 0.045 + ((i * 37) % 10) * 0.0045
      brightness[i] = 0.7 + ((i * 17) % 10) * 0.018
    }

    const buffer = new BufferGeometry()
    buffer.setAttribute('position', new Float32BufferAttribute(positions, 3))
    buffer.setAttribute('aPhase', new Float32BufferAttribute(phases, 1))
    buffer.setAttribute('aSize', new Float32BufferAttribute(sizes, 1))
    buffer.setAttribute('aBrightness', new Float32BufferAttribute(brightness, 1))
    return buffer
  }, [count])

  useFrame(({ clock }, delta) => {
    if (group.current) group.current.scale.setScalar(sphereRadius)
    if (!animate) return
    if (material.current) {
      const uniforms = material.current.uniforms
      uniforms.uTime.value = clock.elapsedTime
      if (pointerRef) {
        const input = pointerRef.current
        const damping = 1 - Math.exp(-delta * 7)
        uniforms.uMousePosition.value.x += (input.x - uniforms.uMousePosition.value.x) * damping
        uniforms.uMousePosition.value.y += (input.y - uniforms.uMousePosition.value.y) * damping
        uniforms.uMouseDirection.value.x += (input.directionX - uniforms.uMouseDirection.value.x) * damping
        uniforms.uMouseDirection.value.y += (input.directionY - uniforms.uMouseDirection.value.y) * damping
        uniforms.uMouseStrength.value += (input.strength - uniforms.uMouseStrength.value) * damping
        input.strength *= Math.exp(-delta * 2.4)
      }
    }
    if (group.current) {
      group.current.rotation.y += delta * 0.035
      group.current.rotation.x = Math.sin(clock.elapsedTime * 0.12) * 0.045
    }
  })

  return (
    <group ref={group}>
      <points geometry={geometry}>
        <shaderMaterial
          ref={material}
          uniforms={{
            uTime: { value: 0 },
            uMousePosition: { value: new Vector2() },
            uMouseDirection: { value: new Vector2(1, 0) },
            uMouseStrength: { value: 0 },
          }}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  )
}

export default function HeroParticleSphere({ fallback, pointerRef }) {
  const quality = useQuality()
  const reduced = useReducedMotion()

  return (
    <SceneCanvas
      className="size-full"
      fallback={fallback}
      camera={{ position: [0, 0, 7.6], fov: 38 }}
      dprMax={quality === 'high' ? 1.5 : 1}
    >
      <ParticleField count={quality === 'high' ? 4200 : 1600} animate={!reduced} pointerRef={reduced ? null : pointerRef} />
    </SceneCanvas>
  )
}
