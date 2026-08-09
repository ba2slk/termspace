import { describe, expect, it } from 'vitest'
import { AUTOSCROLL_STEP, AUTOSCROLL_ZONE, autoscrollStep } from './edge-autoscroll'

const viewport = { left: 100, width: 1000 } // right border at 1100

describe('autoscrollStep', () => {
  it('stays still while the pointer is away from the right border', () => {
    expect(autoscrollStep(600, viewport)).toBe(0)
  })

  it('scrolls once the pointer enters the zone', () => {
    expect(autoscrollStep(1100 - AUTOSCROLL_ZONE / 2, viewport)).toBe(AUTOSCROLL_STEP)
  })

  it('counts the zone edge as inside', () => {
    expect(autoscrollStep(1100 - AUTOSCROLL_ZONE, viewport)).toBe(AUTOSCROLL_STEP)
    expect(autoscrollStep(1100 - AUTOSCROLL_ZONE - 1, viewport)).toBe(0)
  })

  /*
   * An unmaximised window lets the pointer past its own border before the
   * screen stops it, and the drag should still be pulling the canvas along.
   */
  it('keeps scrolling past the right border', () => {
    expect(autoscrollStep(1400, viewport)).toBe(AUTOSCROLL_STEP)
  })

  it('ignores the left border, where shrinking hits the minimum width first', () => {
    expect(autoscrollStep(100, viewport)).toBe(0)
    expect(autoscrollStep(-200, viewport)).toBe(0)
  })
})
