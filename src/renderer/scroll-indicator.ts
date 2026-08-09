/**
 * Where the scroll indicator's thumb sits, and what dragging it means.
 *
 * Both directions live here because they have to invert each other: the thumb
 * is now grabbable, and a mapping that only agreed with itself in one direction
 * would leave the canvas short of its end when the thumb reached the end of the
 * rail.
 */
import { CANVAS_EDGE } from './layout-geometry'

/** Below this the thumb is too thin to aim at, so it stops shrinking. */
export const MIN_THUMB = 24

export interface IndicatorMetrics {
  /** Track length: the rail runs between the pane edges, not the full canvas. */
  readonly rail: number
  readonly thumb: number
  readonly offset: number
}

function railOf(viewportWidth: number): number {
  return viewportWidth - CANVAS_EDGE * 2
}

function thumbOf(rail: number, total: number, viewportWidth: number): number {
  return Math.max(MIN_THUMB, rail * (viewportWidth / total))
}

/** Null when there is nothing to scroll, or nothing measured yet. */
export function indicatorMetrics(
  scrollX: number,
  total: number,
  viewportWidth: number,
): IndicatorMetrics | null {
  if (viewportWidth <= 0 || total <= viewportWidth) return null

  const rail = railOf(viewportWidth)
  const thumb = thumbOf(rail, total, viewportWidth)
  const travel = rail - thumb
  const maxScroll = total - viewportWidth
  const offset = travel <= 0 ? 0 : Math.max(0, Math.min((scrollX / maxScroll) * travel, travel))

  return { rail, thumb, offset }
}

/** How far the canvas moves when the thumb is dragged by `dx`. */
export function scrollForThumbDelta(dx: number, total: number, viewportWidth: number): number {
  if (viewportWidth <= 0 || total <= viewportWidth) return 0

  const rail = railOf(viewportWidth)
  const travel = rail - thumbOf(rail, total, viewportWidth)
  if (travel <= 0) return 0

  return (dx * (total - viewportWidth)) / travel
}
