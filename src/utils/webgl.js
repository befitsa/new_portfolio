// src/utils/webgl.js
// Cheap check so we can show a non-3D fallback instead of a broken canvas.
export function hasWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') || canvas.getContext('webgl')),
    )
  } catch {
    return false
  }
}
