import { describe, expect, it } from 'vitest'
import { CANVAS_BOTTOM, CANVAS_EDGE, canvasWidth, paneRects } from './layout-geometry'
import { createLayout, focusDir } from './layout-model'
import {
  clampOverviewScroll,
  MAX_OVERVIEW_SCALE,
  MIN_OVERVIEW_COLUMN_PX,
  moveSelection,
  overviewLayout,
  revealOffset,
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

describe('clampOverviewScroll', () => {
  it('clamps into [0, mapWidth - usable]', () => {
    expect(clampOverviewScroll(-50, 2000, 1000)).toBe(0)
    expect(clampOverviewScroll(5000, 2000, 1000)).toBe(2000 - (1000 - 96))
  })
  it('is 0 when the map fits', () => {
    expect(clampOverviewScroll(120, 500, 1000)).toBe(0)
  })
})

describe('revealOffset', () => {
  const card = { x: 1500, y: 0, width: 100, height: 50 }
  it('scrolls right just enough for a card past the right edge', () => {
    expect(revealOffset(card, 0, 1000, 2000)).toBe(1600 - (1000 - 96))
  })
  it('scrolls left to a card before the left edge', () => {
    expect(revealOffset({ ...card, x: 100 }, 800, 1000, 2000)).toBe(100)
  })
  it('does nothing when the card is visible', () => {
    expect(revealOffset({ ...card, x: 700 }, 600, 1000, 2000)).toBe(600)
  })
})

describe('overviewLayout — sanity against layout-geometry', () => {
  it('the map width is the canvas width shrunk by the scale', () => {
    const overview = overviewLayout(layout, viewport)
    expect(overview.width).toBeCloseTo(canvasWidth(layout) * overview.scale)
  })
})
