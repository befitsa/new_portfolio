// src/lib/fontawesome.js
import { library, config, findIconDefinition } from '@fortawesome/fontawesome-svg-core'

export { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

// Prevent automatic injection of CSS into head since styles are bundled
config.autoAddCss = false

/**
 * Generate an SVG path for a rounded rectangle.
 */
function rrect(x, y, w, h, r) {
  return (
    `M ${x + r} ${y} ` +
    `h ${w - 2 * r} ` +
    `a ${r} ${r} 0 0 1 ${r} ${r} ` +
    `v ${h - 2 * r} ` +
    `a ${r} ${r} 0 0 1 -${r} ${r} ` +
    `h -${w - 2 * r} ` +
    `a ${r} ${r} 0 0 1 -${r} -${r} ` +
    `v -${h - 2 * r} ` +
    `a ${r} ${r} 0 0 1 ${r} -${r} ` +
    'z'
  )
}

/**
 * Generate an SVG path for a stroked rounded rectangle with thin line weight (filled outline).
 */
function strokeRrect(x, y, w, h, r, s) {
  const outer = rrect(x, y, w, h, r)
  const ix = x + s
  const iy = y + s
  const iw = w - 2 * s
  const ih = h - 2 * s
  const ir = Math.max(1, r - s)
  const inner = (
    ` M ${ix + ir} ${iy} ` +
    `a ${ir} ${ir} 0 0 0 -${ir} ${ir} ` +
    `v ${ih - 2 * ir} ` +
    `a ${ir} ${ir} 0 0 0 ${ir} ${ir} ` +
    `h ${iw - 2 * ir} ` +
    `a ${ir} ${ir} 0 0 0 ${ir} -${ir} ` +
    `v -${ih - 2 * ir} ` +
    `a ${ir} ${ir} 0 0 0 -${ir} -${ir} ` +
    'z'
  )
  return outer + inner
}

// Regular (single-layer outline), Duotone Light, and Duotone Thin grid-2 paths (512x512 canvas, 4 tiles in 2x2 grid)
const regularPath = [
  strokeRrect(48, 48, 184, 184, 36, 32),
  strokeRrect(280, 48, 184, 184, 36, 32),
  strokeRrect(48, 280, 184, 184, 36, 32),
  strokeRrect(280, 280, 184, 184, 36, 32),
].join(' ')

const lightSec = `${strokeRrect(48, 48, 184, 184, 28, 24)} ${strokeRrect(280, 280, 184, 184, 28, 24)}`
const lightPri = `${strokeRrect(280, 48, 184, 184, 28, 24)} ${strokeRrect(48, 280, 184, 184, 28, 24)}`

const thinSec = `${strokeRrect(48, 48, 184, 184, 28, 20)} ${strokeRrect(280, 280, 184, 184, 28, 20)}`
const thinPri = `${strokeRrect(280, 48, 184, 184, 28, 20)} ${strokeRrect(48, 280, 184, 184, 28, 20)}`

const solidSec = `${rrect(48, 48, 184, 184, 28)} ${rrect(280, 280, 184, 184, 28)}`
const solidPri = `${rrect(280, 48, 184, 184, 28)} ${rrect(48, 280, 184, 184, 28)}`

export const faGrid2Regular = {
  prefix: 'far',
  iconName: 'grid-2',
  icon: [512, 512, [], 'e196', regularPath],
}

export const faGrid2DuotoneLight = {
  prefix: 'fadl',
  iconName: 'grid-2',
  icon: [512, 512, [], 'e196', [lightSec, lightPri]],
}

export const faGrid2DuotoneThin = {
  prefix: 'fadt',
  iconName: 'grid-2',
  icon: [512, 512, [], 'e196', [thinSec, thinPri]],
}

export const faGrid2Duotone = {
  prefix: 'fad',
  iconName: 'grid-2',
  icon: [512, 512, [], 'e196', [solidSec, solidPri]],
}

// Register icons with Font Awesome library
library.add(faGrid2Regular, faGrid2DuotoneLight, faGrid2DuotoneThin, faGrid2Duotone)

// Registered icon mappings for byPrefixAndName lookup
const iconRegistry = {
  far: {
    'grid-2': faGrid2Regular,
  },
  fadl: {
    'grid-2': faGrid2DuotoneLight,
  },
  fadt: {
    'grid-2': faGrid2DuotoneThin,
  },
  fad: {
    'grid-2': faGrid2Duotone,
  },
}

export const byPrefixAndName = new Proxy(iconRegistry, {
  get(target, prefix) {
    const knownGroup = target[prefix] || {}
    return new Proxy(knownGroup, {
      get(iconGroup, iconName) {
        if (typeof iconName === 'string' && iconName in iconGroup) {
          return iconGroup[iconName]
        }
        return findIconDefinition({ prefix, iconName })
      },
    })
  },
})

export default byPrefixAndName
