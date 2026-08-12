import { describe, expect, it } from 'vitest'
import { CANVAS_BOTTOM, CANVAS_EDGE, canvasWidth, paneRects } from './layout-geometry'
import { createLayout, focusDir } from './layout-model'
import {
  clampStripOffset,
  columnAtLensCenter,
  columnSnapOffset,
  landingScrollX,
  lensOnStrip,
  lensRect,
  MAX_OVERVIEW_SCALE,
  MIN_OVERVIEW_COLUMN_PX,
  moveSelection,
  overviewLayout,
  paneNearestY,
  stripOffsetFor,
} from './overview-model'

/** Two columns, three panes; wider than the 800px viewport below. */
const layout = createLayout([
  { id: 'c1', width: 700, panes: [{ id: 'a1', title: 'editor' }, { id: 'a2', title: 'shell' }] },
  { id: 'c2', width: 900, panes: [{ id: 'b1', title: 'server' }] },
])

const viewport = { width: 800, height: 600, scrollX: 100 }

describe('overviewLayout — scale', () => {
  it('fits the whole canvas inside the viewport', () => {
    const overview = overviewLayout(layout, viewport)
    expect(overview.width).toBeLessThanOrEqual(viewport.width)
    expect(overview.height).toBeLessThanOrEqual(viewport.height)
    expect(overview.scale).toBeGreaterThan(0)
    expect(overview.scale).toBeLessThan(1)
  })

  it('caps the scale so a small session is not blown up', () => {
    const single = createLayout([{ id: 'c1', width: 300, panes: [{ id: 'a1', title: 'one' }] }])
    const overview = overviewLayout(single, { width: 1600, height: 900, scrollX: 0 })
    expect(overview.scale).toBe(MAX_OVERVIEW_SCALE)
  })
})

describe('overviewLayout — cards', () => {
  it('is paneRects shrunk by the scale, one card per pane', () => {
    const overview = overviewLayout(layout, viewport)
    // The map trades the scrollbar clearance for a symmetric bottom inset.
    const rects = paneRects(layout, viewport.height + (CANVAS_BOTTOM - CANVAS_EDGE))
    expect(overview.cards).toHaveLength(rects.length)
    for (const [i, card] of overview.cards.entries()) {
      const rect = rects[i]!
      expect(card.paneId).toBe(rect.paneId)
      expect(card.x).toBeCloseTo(rect.x * overview.scale)
      expect(card.y).toBeCloseTo(rect.y * overview.scale)
      expect(card.width).toBeCloseTo(rect.width * overview.scale)
      expect(card.height).toBeCloseTo(rect.height * overview.scale)
    }
  })

  it('sits symmetrically inside the marker: the map has no scrollbar to clear', () => {
    const overview = overviewLayout(layout, viewport)
    const top = Math.min(...overview.cards.map((c) => c.y))
    const bottom = overview.height - Math.max(...overview.cards.map((c) => c.y + c.height))
    expect(bottom).toBeCloseTo(top)
  })

  it('keeps the columns\' width proportions', () => {
    const overview = overviewLayout(layout, viewport)
    const a1 = overview.cards.find((c) => c.paneId === 'a1')!
    const b1 = overview.cards.find((c) => c.paneId === 'b1')!
    expect(b1.width / a1.width).toBeCloseTo(900 / 700)
  })
})

describe('overviewLayout — viewport marker', () => {
  it('marks the part of the canvas the viewport shows now', () => {
    const overview = overviewLayout(layout, viewport)
    expect(overview.viewportRect.x).toBeCloseTo(viewport.scrollX * overview.scale)
    expect(overview.viewportRect.width).toBeCloseTo(viewport.width * overview.scale)
    expect(overview.viewportRect.height).toBe(overview.height)
  })

  it('never reaches past the map', () => {
    const wide = { width: 800, height: 600, scrollX: 5000 }
    const overview = overviewLayout(layout, wide)
    expect(overview.viewportRect.x + overview.viewportRect.width).toBeLessThanOrEqual(
      overview.width + 1e-6,
    )
  })
})

describe('moveSelection', () => {
  it('moves exactly as canvas focus movement does', () => {
    for (const dir of ['left', 'right', 'up', 'down'] as const) {
      const expected = focusDir({ ...layout, focusedPaneId: 'a1' }, dir)
      expect(moveSelection(layout, 'a1', dir)).toEqual(expected)
    }
  })

  it('stays put at an edge', () => {
    expect(moveSelection(layout, 'b1', 'right').focusedPaneId).toBe('b1')
  })

  it('down, right, left comes back, because desiredY survives the steps', () => {
    // Same rule as the canvas: vertical moves set desiredY, horizontal ones keep it.
    const down = moveSelection(layout, 'a1', 'down')
    expect(down.focusedPaneId).toBe('a2')
    const right = moveSelection(down, 'a2', 'right')
    const back = moveSelection(right, right.focusedPaneId, 'left')
    expect(back.focusedPaneId).toBe('a2')
  })
})

/** n one-pane columns of the same width. */
const manyColumns = (n: number, width: number) =>
  createLayout(
    Array.from({ length: n }, (_, i) => ({
      id: `c${String(i)}`,
      width,
      panes: [{ id: `p${String(i)}`, title: `pane ${String(i)}` }],
    })),
  )

describe('scale floor', () => {
  it('never lets the narrowest column drop below MIN_OVERVIEW_COLUMN_PX', () => {
    // 12 columns × 640px in a 1280×800 viewport: fit-scale would be tiny.
    const wide = manyColumns(12, 640)
    const { scale } = overviewLayout(wide, { width: 1280, height: 800, scrollX: 0 })
    expect(640 * scale).toBeGreaterThanOrEqual(MIN_OVERVIEW_COLUMN_PX)
  })

  it('leaves a small session exactly as before', () => {
    const small = manyColumns(2, 640)
    const big = { width: 1280, height: 800, scrollX: 0 }
    const { scale } = overviewLayout(small, big)
    // Fit already beats the floor here: today's formula must be unchanged.
    expect(scale).toBeCloseTo(Math.min(0.5, (1280 - 96) / canvasWidth(small), (800 - 96) / 800))
  })
})

/*
 * The lens is fixed and the strip slides under it. One rule ties the two:
 * a map coordinate x is drawn at screen OVERVIEW_MARGIN + x - offset.
 */
describe('the lens and the strip', () => {
  const viewport = { width: 1000, height: 600, scrollX: 0 }
  const scale = 0.2
  const lens = { x: 400, width: 200 }
  const screenXOf = (x: number, offset: number): number => 48 + x - offset

  it('centres the lens in the room the map gets', () => {
    // usable = 1000 - 96 = 904; width = viewport × scale = 200.
    expect(lensRect(viewport, scale, 4000)).toEqual({ x: 400, width: 200 })
  })

  it('never lets the lens outgrow the room', () => {
    const wide = lensRect({ width: 400, height: 600, scrollX: 0 }, 0.9, 4000)
    expect(wide.width).toBe(400 - 96)
    expect(wide.x).toBe(48)
  })

  it('aligns the canvas region into the lens', () => {
    const offset = stripOffsetFor(500, scale, lens)
    // The canvas at 500 is map-x 100, and it must be drawn at the lens edge.
    expect(screenXOf(100, offset)).toBe(lens.x)
  })

  it('puts the lens on the strip where the screen shows it', () => {
    const offset = stripOffsetFor(500, scale, lens)
    expect(screenXOf(lensOnStrip(offset, lens), offset)).toBe(lens.x)
  })

  it('landingScrollX is the inverse of stripOffsetFor', () => {
    const offset = stripOffsetFor(500, scale, lens)
    expect(landingScrollX(offset, scale, 10000, viewport, lens)).toBeCloseTo(500)
  })

  it('landing clamps to the canvas it can actually reach', () => {
    const past = stripOffsetFor(99999, scale, lens)
    expect(landingScrollX(past, scale, 4000, viewport, lens)).toBe(3000)
    const before = stripOffsetFor(-500, scale, lens)
    expect(landingScrollX(before, scale, 4000, viewport, lens)).toBe(0)
  })
})

describe('clampStripOffset', () => {
  const lens = { x: 400, width: 200 }
  const screenXOf = (x: number, offset: number): number => 48 + x - offset

  it('lets the first column reach the lens, and no further', () => {
    const min = clampStripOffset(-99999, 2000, lens)
    expect(screenXOf(0, min)).toBe(lens.x)
  })

  it('lets the last column reach the lens, and no further', () => {
    const max = clampStripOffset(99999, 2000, lens)
    expect(screenXOf(2000, max)).toBe(lens.x + lens.width)
  })

  it('leaves an offset inside the bounds alone', () => {
    expect(clampStripOffset(120, 2000, lens)).toBe(120)
  })

  it('survives a map narrower than the lens', () => {
    const offset = clampStripOffset(0, 50, lens)
    expect(Number.isFinite(offset)).toBe(true)
  })
})

describe('column snap and the centred column', () => {
  // Three columns, 100 wide, at map x 0 / 150 / 300: centres 50, 200, 350.
  const cards = [
    { paneId: 'a', columnId: 'c1', x: 0, y: 0, width: 100, height: 40 },
    { paneId: 'b', columnId: 'c1', x: 0, y: 50, width: 100, height: 40 },
    { paneId: 'c', columnId: 'c2', x: 150, y: 0, width: 100, height: 90 },
    { paneId: 'd', columnId: 'c3', x: 300, y: 0, width: 100, height: 90 },
  ]
  const lens = { x: 400, width: 200 }
  // Centring column centre c means offset = 48 + c - 500.
  const centred = (c: number): number => 48 + c - 500

  it('names the column sitting under the lens centre', () => {
    expect(columnAtLensCenter(cards, centred(200), lens)).toBe('c2')
    expect(columnAtLensCenter(cards, centred(50), lens)).toBe('c1')
  })

  it('picks the nearest column when the strip is between two', () => {
    expect(columnAtLensCenter(cards, centred(190), lens)).toBe('c2')
  })

  it('steps one column right, and stops at the last', () => {
    expect(columnSnapOffset(cards, centred(50), 'right', lens)).toBeCloseTo(centred(200))
    expect(columnSnapOffset(cards, centred(350), 'right', lens)).toBeCloseTo(centred(350))
  })

  it('steps one column left, and stops at the first', () => {
    expect(columnSnapOffset(cards, centred(200), 'left', lens)).toBeCloseTo(centred(50))
    expect(columnSnapOffset(cards, centred(50), 'left', lens)).toBeCloseTo(centred(50))
  })

  it('steps from between two columns without skipping one', () => {
    expect(columnSnapOffset(cards, centred(120), 'right', lens)).toBeCloseTo(centred(200))
    expect(columnSnapOffset(cards, centred(120), 'left', lens)).toBeCloseTo(centred(50))
  })
})

describe('paneNearestY', () => {
  const cards = [
    { paneId: 'top', columnId: 'c1', x: 0, y: 0, width: 100, height: 40 },
    { paneId: 'bottom', columnId: 'c1', x: 0, y: 50, width: 100, height: 40 },
    { paneId: 'only', columnId: 'c2', x: 150, y: 0, width: 100, height: 90 },
  ]

  it('keeps the vertical place when the column changes', () => {
    expect(paneNearestY(cards, 'c1', 70)).toBe('bottom')
    expect(paneNearestY(cards, 'c1', 5)).toBe('top')
  })

  it('is null for a column that is not there', () => {
    expect(paneNearestY(cards, 'gone', 0)).toBeNull()
  })
})

describe('overviewLayout — sanity against layout-geometry', () => {
  it('the map width is the canvas width shrunk by the scale', () => {
    const overview = overviewLayout(layout, viewport)
    expect(overview.width).toBeCloseTo(canvasWidth(layout) * overview.scale)
  })
})
