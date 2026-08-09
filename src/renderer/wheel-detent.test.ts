import { describe, expect, it } from 'vitest'
import { createWheelDetent, DETENT_PX, DETENT_GESTURE_GAP_MS } from './wheel-detent'

/** deltaMode 1 (lines): one mouse notch is deltaY 3 → 48px via wheelPixels. */
const NOTCH = { delta: 3, mode: 1 }

describe('createWheelDetent', () => {
  it('one mouse notch is one step down', () => {
    const detent = createWheelDetent()
    expect(detent.feed(NOTCH.delta, NOTCH.mode, 0)).toBe(1)
  })

  it('one upward notch is one step up', () => {
    const detent = createWheelDetent()
    expect(detent.feed(-NOTCH.delta, NOTCH.mode, 0)).toBe(-1)
  })

  it('every notch of a fast roll lands exactly one step', () => {
    const detent = createWheelDetent()
    const steps = [0, 50, 100, 150].map((t) => detent.feed(NOTCH.delta, NOTCH.mode, t))
    expect(steps).toEqual([1, 1, 1, 1])
  })

  it('small trackpad deltas accumulate to a step at the threshold', () => {
    const detent = createWheelDetent()
    expect(detent.feed(DETENT_PX / 2, 0, 0)).toBe(0)
    expect(detent.feed(DETENT_PX / 2, 0, 16)).toBe(1)
  })

  it('a huge single delta is still one step, not several', () => {
    const detent = createWheelDetent()
    expect(detent.feed(DETENT_PX * 5, 0, 0)).toBe(1)
  })

  it('discards the remainder once a step fires', () => {
    const detent = createWheelDetent()
    const px = (DETENT_PX / 2) * 1.2
    const steps = [0, 16, 32, 48].map((t) => detent.feed(px, 0, t))
    // With carry-over the third event would fire early; steps land on 2nd and 4th.
    expect(steps).toEqual([0, 1, 0, 1])
  })

  it('a direction change resets the accumulation', () => {
    const detent = createWheelDetent()
    expect(detent.feed(DETENT_PX * 0.9, 0, 0)).toBe(0)
    expect(detent.feed(-DETENT_PX * 0.2, 0, 16)).toBe(0)
    // The 0.9 must be gone: 0.2 more down does not reach the threshold.
    expect(detent.feed(DETENT_PX * 0.2, 0, 32)).toBe(0)
  })

  it('a pause between gestures resets the accumulation', () => {
    const detent = createWheelDetent()
    expect(detent.feed(DETENT_PX * 0.9, 0, 0)).toBe(0)
    expect(detent.feed(DETENT_PX * 0.9, 0, DETENT_GESTURE_GAP_MS + 50)).toBe(0)
  })

  it('ignores a decaying inertia tail', () => {
    const detent = createWheelDetent()
    detent.feed(DETENT_PX * 2, 0, 0)
    // Fling released: magnitudes only shrink. None of it may accumulate.
    let total = 0
    let px = DETENT_PX * 0.8
    for (let t = 16; t <= 400; t += 16) {
      total += detent.feed(px, 0, t)
      px *= 0.85
    }
    expect(total).toBe(0)
  })

  it('counts again when the finger pushes anew mid-stream', () => {
    const detent = createWheelDetent()
    detent.feed(DETENT_PX * 2, 0, 0)
    detent.feed(DETENT_PX * 0.5, 0, 16) // tail…
    detent.feed(DETENT_PX * 0.25, 0, 32) // …still tail
    // A rising delta is a new push, not inertia.
    expect(detent.feed(DETENT_PX * 1.5, 0, 48)).toBe(1)
  })
})
