// src/hooks/useQuality.js
import { useState } from 'react'

// Decide once whether to run the "high" or "low" 3D settings.
// Low = fewer particles, no live shadows, smaller pixel ratio.
function detect() {
  if (typeof window === 'undefined') return 'low'
  const mem = navigator.deviceMemory // not available in Safari/Firefox
  const cores = navigator.hardwareConcurrency || 4
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const saveData = navigator.connection?.saveData
  if (saveData || window.innerWidth < 768) return 'low'
  if ((mem && mem <= 2) || cores <= 2) return 'low'
  if (coarse && ((mem && mem <= 4) || cores <= 4)) return 'low'
  return 'high'
}

export function useQuality() {
  const [quality] = useState(detect)
  return quality
}
