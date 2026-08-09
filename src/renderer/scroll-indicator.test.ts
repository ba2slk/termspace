import { describe, expect, it } from 'vitest'
import { CANVAS_EDGE } from './layout-geometry'
import { indicatorMetrics, MIN_THUMB, scrollForThumbDelta } from './scroll-indicator'

const VIEW = 1000
const RAIL = VIEW - CANVAS_EDGE * 2

describe('indicatorMetrics', () => {
  it('has nothing to show when the canvas fits the viewport', () => {
    expect(indicatorMetrics(0, VIEW, VIEW)).toBeNull()
    expect(indicatorMetrics(0, VIEW - 1, VIEW)).toBeNull()
  })

  it('has nothing to show before the viewport has been measured', () => {
    expect(indicatorMetrics(0, 4000, 0)).toBeNull()
  })

  it('sizes the thumb by the visible fraction', () => {
    const metrics = indicatorMetrics(0, VIEW * 4, VIEW)!
    expect(metrics.rail).toBe(RAIL)
    expect(metrics.thumb).toBeCloseTo(RAIL / 4, 9)
  })

  it('keeps the thumb grabbable on a very wide canvas', () => {
    const metrics = indicatorMetrics(0, VIEW * 1000, VIEW)!
    expect(metrics.thumb).toBe(MIN_THUMB)
  })

  it('runs the thumb from one end of its travel to the other', () => {
    const total = VIEW * 4
    const start = indicatorMetrics(0, total, VIEW)!
    const end = indicatorMetrics(total - VIEW, total, VIEW)!
    expect(start.offset).toBe(0)
    expect(end.offset).toBeCloseTo(end.rail - end.thumb, 9)
  })

  it('holds the thumb inside the rail when the scroll runs past its end', () => {
    const metrics = indicatorMetrics(99_999, VIEW * 4, VIEW)!
    expect(metrics.offset).toBeCloseTo(metrics.rail - metrics.thumb, 9)
  })
})

describe('scrollForThumbDelta', () => {
  /*
   * The two directions have to agree, or dragging the thumb to the end would
   * leave the canvas short of its own end.
   */
  it('inverts the offset mapping', () => {
    const total = VIEW * 4
    const { rail, thumb } = indicatorMetrics(0, total, VIEW)!
    expect(scrollForThumbDelta(rail - thumb, total, VIEW)).toBeCloseTo(total - VIEW, 9)
  })

  it('inverts it on a canvas wide enough to pin the thumb at its minimum', () => {
    const total = VIEW * 1000
    const { rail, thumb } = indicatorMetrics(0, total, VIEW)!
    expect(scrollForThumbDelta(rail - thumb, total, VIEW)).toBeCloseTo(total - VIEW, 9)
  })

  it('carries the sign, so dragging back scrolls back', () => {
    expect(scrollForThumbDelta(-10, VIEW * 4, VIEW)).toBeCloseTo(
      -scrollForThumbDelta(10, VIEW * 4, VIEW),
      9,
    )
  })

  it('stays put when the thumb has no room to travel', () => {
    // A viewport too narrow for the minimum thumb leaves the rail shorter than it.
    expect(scrollForThumbDelta(10, 4000, 30)).toBe(0)
  })
})
