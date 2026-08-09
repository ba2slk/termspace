/**
 * Wheel scrolling physics, shared by the horizontal canvas and the terminal's
 * vertical scroll so both axes feel the same.
 */

/** Fraction of the remaining distance covered per frame. Higher is stiffer. */
export const WHEEL_GLIDE = 0.19

/** Notches closer together than this count as a continuous roll. */
export const WHEEL_BURST_MS = 130

/** Multiplier applied per notch while rolling continuously. */
export const BURST_RAMP = 1.35

/** Ceiling on the burst multiplier. */
export const BURST_MAX = 2.4

/** Decay applied once the roll stops. */
export const BURST_DECAY = 0.55

/**
 * Ramp the burst multiplier up while rolling, decay it once the roll stops.
 *
 * @param previous multiplier from the last notch
 * @param gapMs time since the last wheel event
 */
export function nextBurst(previous: number, gapMs: number): number {
  return gapMs < WHEEL_BURST_MS
    ? Math.min(BURST_MAX, previous * BURST_RAMP)
    : Math.max(1, previous * BURST_DECAY)
}

/** Normalise wheel delta to pixels. deltaMode 1 is lines, 2 is pages. */
export function wheelPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * 16
  if (deltaMode === 2) return delta * 400
  return delta
}

/** Glide step for this frame, corrected for the actual frame interval. */
export function glideFactor(dtMs: number): number {
  return 1 - (1 - WHEEL_GLIDE) ** (dtMs / FRAME_MS)
}

/** One frame at 60fps — the baseline for the exponential correction. */
export const FRAME_MS = 1000 / 60
