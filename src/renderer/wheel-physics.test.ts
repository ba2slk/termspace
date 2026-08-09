import { describe, expect, it } from 'vitest'
import {
  BURST_MAX,
  FRAME_MS,
  glideFactor,
  nextBurst,
  wheelPixels,
  WHEEL_BURST_MS,
} from './wheel-physics'

describe('nextBurst', () => {
  it('ramps up while rolling continuously', () => {
    const first = nextBurst(1, 40)
    const second = nextBurst(first, 40)
    expect(first).toBeGreaterThan(1)
    expect(second).toBeGreaterThan(first)
  })

  it('never exceeds the ceiling', () => {
    let burst = 1
    for (let i = 0; i < 50; i++) burst = nextBurst(burst, 10)
    expect(burst).toBe(BURST_MAX)
  })

  it('decays once the roll stops', () => {
    const fast = nextBurst(nextBurst(1, 10), 10)
    expect(nextBurst(fast, WHEEL_BURST_MS + 1)).toBeLessThan(fast)
  })

  it('never decays below 1', () => {
    let burst = 2
    for (let i = 0; i < 20; i++) burst = nextBurst(burst, 1000)
    expect(burst).toBe(1)
  })

  it('the exact boundary counts as a break, not a roll', () => {
    expect(nextBurst(1, WHEEL_BURST_MS)).toBe(1)
  })
})

describe('wheelPixels', () => {
  it('leaves pixel deltas alone', () => {
    expect(wheelPixels(120, 0)).toBe(120)
  })

  it('scales line and page deltas to pixels', () => {
    // Without this a mouse wheel moves a fraction of a trackpad's distance.
    expect(wheelPixels(3, 1)).toBe(48)
    expect(wheelPixels(1, 2)).toBe(400)
  })

  it('preserves sign', () => {
    expect(wheelPixels(-3, 1)).toBe(-48)
  })
})

describe('glideFactor', () => {
  it('matches the base ratio at one 60fps frame', () => {
    expect(glideFactor(FRAME_MS)).toBeCloseTo(0.19, 6)
  })

  it('covers more ground when frames are late', () => {
    expect(glideFactor(FRAME_MS * 2)).toBeGreaterThan(glideFactor(FRAME_MS))
  })

  it('stays between 0 and 1', () => {
    for (const dt of [1, FRAME_MS, 64, 200]) {
      expect(glideFactor(dt)).toBeGreaterThan(0)
      expect(glideFactor(dt)).toBeLessThan(1)
    }
  })
})
