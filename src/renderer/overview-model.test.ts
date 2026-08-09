import { describe, expect, it } from 'vitest'
import { CANVAS_BOTTOM, CANVAS_EDGE, canvasWidth, paneRects } from './layout-geometry'
import { createLayout, focusDir } from './layout-model'
import { MAX_OVERVIEW_SCALE, moveSelection, overviewLayout } from './overview-model'

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

describe('overviewLayout — sanity against layout-geometry', () => {
  it('the map width is the canvas width shrunk by the scale', () => {
    const overview = overviewLayout(layout, viewport)
    expect(overview.width).toBeCloseTo(canvasWidth(layout) * overview.scale)
  })
})
