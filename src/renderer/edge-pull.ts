/**
 * How far the canvas yields when the wheel keeps going past either end.
 *
 * The scroll position itself never leaves its range. The overrun is kept as a
 * separate gesture distance and drawn as an offset on top of the scroll.
 */

/** Furthest the track is drawn past its edge, in pixels. */
export const EDGE_PULL_MAX = 64

/** Overrun distance at which the pull has covered about 63% of its maximum. */
export const EDGE_PULL_REACH = 130

/** Ceiling on the accumulated overrun, so a long roll unwinds in bounded input. */
export const EDGE_DISTANCE_MAX = 600

/** Wheel events closer together than this belong to the same gesture. */
export const EDGE_GESTURE_GAP_MS = 160

/** Silence after the last wheel event before the pull starts to let go. */
export const EDGE_HOLD_MS = 80

/** Time scale of the release once it has started. */
export const EDGE_RELEASE_MS = 110

/** Time constant with which the drawn offset follows its target. */
export const EDGE_FOLLOW_MS = 35

/** Longest frame interval the follow step corrects for. */
export const EDGE_FRAME_CAP_MS = 32

/** Below this the offset is treated as back at the edge. */
export const EDGE_REST_PX = 0.2

/**
 * Offset for an accumulated overrun. It opposes the gesture and approaches
 * EDGE_PULL_MAX without reaching it.
 */
export function edgePullFor(distance: number): number {
  if (distance === 0) return 0
  return -Math.sign(distance) * EDGE_PULL_MAX * (1 - Math.exp(-Math.abs(distance) / EDGE_PULL_REACH))
}

/**
 * Share of the pull still held this long after the last wheel event.
 *
 * Wheel events have no release phase. The target eases away after silence
 * instead of dropping to zero in one frame, which reads as a snap.
 */
export function edgeRelease(sinceInputMs: number): number {
  const silence = Math.max(0, sinceInputMs - EDGE_HOLD_MS)
  return Math.exp(-((silence / EDGE_RELEASE_MS) ** 2))
}

/** Fraction of the gap to the target closed this frame. */
export function edgeFollow(dtMs: number): number {
  return 1 - Math.exp(-dtMs / EDGE_FOLLOW_MS)
}

/**
 * Part of a wheel delta that goes into undoing the overrun rather than
 * scrolling: input against a pull still in the same gesture, up to all of it.
 */
export function edgeUnwind(distance: number, delta: number, sinceInputMs: number): number {
  if (distance === 0 || sinceInputMs > EDGE_GESTURE_GAP_MS) return 0
  if (Math.sign(delta) === Math.sign(distance)) return 0
  return Math.min(Math.abs(delta), Math.abs(distance))
}

/**
 * Overrun after input that ran past the edge. A new gesture, or one at the
 * other edge, starts from zero.
 *
 * @param delta unboosted wheel distance; scroll acceleration must not amplify the pull
 * @param overflow how far the wanted scroll position fell outside its range
 */
export function edgeOverrun(
  distance: number,
  delta: number,
  overflow: number,
  sinceInputMs: number,
): number {
  const fresh = Math.sign(distance) !== Math.sign(overflow) || sinceInputMs > EDGE_GESTURE_GAP_MS
  const held = fresh ? 0 : distance
  return Math.max(-EDGE_DISTANCE_MAX, Math.min(EDGE_DISTANCE_MAX, held + delta))
}
