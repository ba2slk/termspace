import { describe, expect, it } from 'vitest'
import {
  EDGE_DISTANCE_MAX,
  EDGE_FOLLOW_MS,
  EDGE_GESTURE_GAP_MS,
  EDGE_HOLD_MS,
  EDGE_PULL_MAX,
  edgeFollow,
  edgeOverrun,
  edgePullFor,
  edgeRelease,
  edgeUnwind,
} from './edge-pull'

describe('edgePullFor', () => {
  it('is zero with no overrun', () => {
    expect(edgePullFor(0)).toBe(0)
  })

  it('opposes the gesture', () => {
    expect(edgePullFor(-100)).toBeGreaterThan(0)
    expect(edgePullFor(100)).toBeLessThan(0)
    expect(edgePullFor(100)).toBe(-edgePullFor(-100))
  })

  it('grows with the overrun', () => {
    expect(edgePullFor(-200)).toBeGreaterThan(edgePullFor(-100))
  })

  it('stays under the maximum at the largest overrun', () => {
    expect(edgePullFor(-EDGE_DISTANCE_MAX)).toBeLessThan(EDGE_PULL_MAX)
    expect(edgePullFor(-EDGE_DISTANCE_MAX)).toBeGreaterThan(EDGE_PULL_MAX * 0.9)
  })
})

describe('edgeRelease', () => {
  it('holds everything while input is recent', () => {
    expect(edgeRelease(0)).toBe(1)
    expect(edgeRelease(EDGE_HOLD_MS)).toBe(1)
  })

  it('lets go gradually once the hold is over', () => {
    const early = edgeRelease(EDGE_HOLD_MS + 20)
    const late = edgeRelease(EDGE_HOLD_MS + 120)
    expect(early).toBeLessThan(1)
    expect(early).toBeGreaterThan(0.9)
    expect(late).toBeLessThan(early)
  })

  it('has let go of nearly everything well after', () => {
    expect(edgeRelease(EDGE_HOLD_MS + 400)).toBeLessThan(0.001)
  })
})

describe('edgeFollow', () => {
  it('stays between 0 and 1', () => {
    for (const dt of [1, 8, 16, 32]) {
      expect(edgeFollow(dt)).toBeGreaterThan(0)
      expect(edgeFollow(dt)).toBeLessThan(1)
    }
  })

  it('covers more ground when frames are late', () => {
    expect(edgeFollow(32)).toBeGreaterThan(edgeFollow(16))
  })

  it('reaches the same place in two short frames as in one long one', () => {
    const twoShort = 1 - (1 - edgeFollow(EDGE_FOLLOW_MS / 2)) ** 2
    expect(twoShort).toBeCloseTo(edgeFollow(EDGE_FOLLOW_MS))
  })
})

describe('edgeUnwind', () => {
  it('takes reverse input out of the overrun first', () => {
    expect(edgeUnwind(-180, 80, 10)).toBe(80)
  })

  it('takes no more than the overrun, leaving the rest to scroll', () => {
    expect(edgeUnwind(-40, 120, 10)).toBe(40)
  })

  it('leaves input in the same direction alone', () => {
    expect(edgeUnwind(-40, -20, 10)).toBe(0)
  })

  it('leaves input alone when nothing is pulled', () => {
    expect(edgeUnwind(0, 120, 10)).toBe(0)
  })

  it('leaves a new gesture alone', () => {
    expect(edgeUnwind(-40, 120, EDGE_GESTURE_GAP_MS)).toBe(40)
    expect(edgeUnwind(-40, 120, EDGE_GESTURE_GAP_MS + 1)).toBe(0)
  })
})

describe('edgeOverrun', () => {
  it('adds up within one gesture', () => {
    expect(edgeOverrun(-20, -20, -50, 30)).toBe(-40)
  })

  it('starts from zero on a new gesture', () => {
    expect(edgeOverrun(-200, -20, -50, EDGE_GESTURE_GAP_MS + 1)).toBe(-20)
  })

  it('starts from zero at the other edge', () => {
    expect(edgeOverrun(-200, 20, 50, 30)).toBe(20)
  })

  it('never exceeds the ceiling in either direction', () => {
    expect(edgeOverrun(-590, -100, -250, 30)).toBe(-EDGE_DISTANCE_MAX)
    expect(edgeOverrun(590, 100, 250, 30)).toBe(EDGE_DISTANCE_MAX)
  })
})
