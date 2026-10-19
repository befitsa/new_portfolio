// src/hooks/usePointerRef.js
import { useEffect, useRef } from 'react'

// Tracks the mouse position (-1..1) in a ref. A ref (not state) on purpose:
// updating it never re-renders React, and the 3D loop just reads it every frame.
export function usePointerRef(enabled = true) {
  const pointer = useRef({ x: 0, y: 0 })
  useEffect(() => {
    if (!enabled) return undefined
    const onMove = (e) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [enabled])
  return pointer
}
