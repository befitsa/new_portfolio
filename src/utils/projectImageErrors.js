export function warnProjectImageLoadFailure(projectTitle, imageType, source) {
  if (!import.meta.env.DEV) return
  console.warn(`[project image] ${projectTitle} ${imageType} failed to load: ${source}`)
}
