/**
 * Turns a wheel-delta stream into discrete ±1 steps — the "clicks" of the
 * sidebar's session dial. The opposite goal of wheel-physics, which smooths;
 * here every step must land hard and inertia must land nowhere.
 *
 * Time comes in through feed() so the module stays pure.
 */
import { wheelPixels } from './wheel-physics'

/** Pixels per click. Below one mouse notch (48px) so a notch always lands. */
export const DETENT_PX = 40

/** Events further apart than this start a fresh gesture. */
export const DETENT_GESTURE_GAP_MS = 130

export interface WheelDetent {
  /** Feed one wheel event; returns -1, 0 or 1 sessions to move. */
  feed(deltaY: number, deltaMode: number, nowMs: number): -1 | 0 | 1
}

export function createWheelDetent(): WheelDetent {
  let acc = 0
  let lastAbs = 0
  let lastAt = -Infinity

  return {
    feed(deltaY, deltaMode, nowMs) {
      const px = wheelPixels(deltaY, deltaMode)
      const gap = nowMs - lastAt
      const prevAbs = gap > DETENT_GESTURE_GAP_MS ? 0 : lastAbs
      lastAt = nowMs
      lastAbs = Math.abs(px)

      if (prevAbs === 0 || Math.sign(px) !== Math.sign(acc)) acc = 0

      // A shrinking magnitude mid-stream is a released fling, not the finger.
      if (Math.abs(px) < prevAbs) return 0

      acc += px
      if (Math.abs(acc) < DETENT_PX) return 0
      const step = acc > 0 ? 1 : -1
      acc = 0
      return step
    },
  }
}
