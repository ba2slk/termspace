const SVG_NS = 'http://www.w3.org/2000/svg'

/** Proportions of the mark, in the 256 viewBox build/icon.svg is drawn in. */
export interface MarkShape {
  orbRadius: number
  orbStroke: number
  ringLength: number
  ringHalf: number
  /** Width of the knockout where the ring crosses the planet. */
  gapStroke: number
}

/** The icon's own proportions, for sizes with room for them. */
export const MARK_CANVAS: MarkShape = {
  orbRadius: 56,
  orbStroke: 10,
  ringLength: 124,
  ringHalf: 13,
  gapStroke: 14,
}

/**
 * Heavier, for the title bar. Scaled down to 16px the icon's own strokes land
 * under a pixel and the planet thins out to nothing.
 */
export const MARK_CHROME: MarkShape = {
  orbRadius: 52,
  orbStroke: 17,
  ringLength: 118,
  ringHalf: 18,
  gapStroke: 18,
}

let nextId = 0

function ringPath({ ringLength: l, ringHalf: h }: MarkShape): string {
  const s = l * 0.37
  return (
    `M ${String(-l)} 0 Q ${String(-s)} ${String(-h)} 0 ${String(-h)} ` +
    `Q ${String(s)} ${String(-h)} ${String(l)} 0 ` +
    `Q ${String(s)} ${String(h)} 0 ${String(h)} ` +
    `Q ${String(-s)} ${String(h)} ${String(-l)} 0 Z`
  )
}

/**
 * The app icon's geometry alone, in the current colour. The icon proper is a
 * lit white object on a black tile, and dropping that into the chrome would
 * read as a sticker rather than as part of the app.
 */
export function createAppMark(shape: MarkShape, size?: number): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 256 256')
  svg.setAttribute('aria-hidden', 'true')
  if (size !== undefined) {
    svg.setAttribute('width', String(size))
    svg.setAttribute('height', String(size))
  }

  const d = ringPath(shape)
  const tilt = 'translate(128 128) rotate(-38)'

  /*
   * Both shapes are the one colour, so without a gap they fuse where they
   * cross. Cut it with a mask rather than paint it in the background colour:
   * this sits on a button that changes colour under the pointer.
   */
  const maskId = `app-mark-${String(nextId++)}`
  const mask = document.createElementNS(SVG_NS, 'mask')
  mask.setAttribute('id', maskId)
  mask.setAttribute('maskUnits', 'userSpaceOnUse')
  mask.setAttribute('x', '0')
  mask.setAttribute('y', '0')
  mask.setAttribute('width', '256')
  mask.setAttribute('height', '256')

  const shown = document.createElementNS(SVG_NS, 'rect')
  shown.setAttribute('width', '256')
  shown.setAttribute('height', '256')
  shown.setAttribute('fill', '#fff')

  const cut = document.createElementNS(SVG_NS, 'path')
  cut.setAttribute('d', d)
  cut.setAttribute('transform', tilt)
  cut.setAttribute('fill', 'none')
  cut.setAttribute('stroke', '#000')
  cut.setAttribute('stroke-width', String(shape.gapStroke))
  cut.setAttribute('stroke-linejoin', 'round')

  mask.append(shown, cut)

  const orb = document.createElementNS(SVG_NS, 'circle')
  orb.setAttribute('cx', '128')
  orb.setAttribute('cy', '128')
  orb.setAttribute('r', String(shape.orbRadius))
  orb.setAttribute('fill', 'none')
  orb.setAttribute('stroke', 'currentColor')
  orb.setAttribute('stroke-width', String(shape.orbStroke))
  orb.setAttribute('mask', `url(#${maskId})`)

  const ring = document.createElementNS(SVG_NS, 'path')
  ring.setAttribute('d', d)
  ring.setAttribute('transform', tilt)
  ring.setAttribute('fill', 'currentColor')

  svg.append(mask, orb, ring)
  return svg
}
