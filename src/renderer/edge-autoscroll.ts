/**
 * How far a column drag can reach.
 *
 * A drag can only widen a column by as much as the pointer can travel, and the
 * pointer stops at the edge of the screen — so the rightmost column could not
 * be widened at all. Pushing into the border scrolls the canvas instead, by the
 * same amount the column grows, which leaves the handle under a still pointer.
 */

/** How close to the right border the pointer must be to start pulling. */
export const AUTOSCROLL_ZONE = 24

/** Per frame, so roughly 480px/s. Fixed: resizing is not a fine-aim gesture. */
export const AUTOSCROLL_STEP = 8

export interface AutoscrollViewport {
  readonly left: number
  readonly width: number
}

export function autoscrollStep(pointerX: number, viewport: AutoscrollViewport): number {
  const border = viewport.left + viewport.width
  return pointerX >= border - AUTOSCROLL_ZONE ? AUTOSCROLL_STEP : 0
}
