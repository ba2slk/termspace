import { describe, expect, it } from 'vitest'
import { columnContentHeight, createLayout, FOLD_BAR_HEIGHT, PANE_GAP } from './layout-model'
import {
  CANVAS_EDGE,
  canvasWidth,
  columnHeightIn,
  maxColumnWidth,
  maxScrollX,
  paneRects,
  type Rect,
  scrollToReveal,
  snapToDevicePixels,
  visiblePaneIds,
} from './layout-geometry'

const layout = createLayout([
  { id: 'c1', width: 700, panes: [{ id: 'a1', title: 'a' }, { id: 'a2', title: 'b' }] },
  { id: 'c2', width: 500, panes: [{ id: 'b1', title: 'c' }] },
  { id: 'c3', width: 900, panes: [{ id: 'c1p', title: 'd' }] },
])
const H = 800

describe('canvasWidth', () => {
  it('sums column widths, gaps and both insets', () => {
    expect(canvasWidth(layout)).toBe(700 + 500 + 900 + PANE_GAP * 2 + CANVAS_EDGE * 2)
  })
})

describe('maxColumnWidth', () => {
  it('is the width at which one column exactly fills the viewport', () => {
    const width = maxColumnWidth(1400)
    const single = createLayout([{ id: 'c1', width, panes: [{ id: 'p', title: 'p' }] }])
    expect(canvasWidth(single)).toBe(1400)
  })
})

describe('paneRects', () => {
  const rects = paneRects(layout, H)

  it('returns a rectangle per pane', () => {
    expect(rects.map((r) => r.paneId)).toEqual(['a1', 'a2', 'b1', 'c1p'])
  })

  it('the first column starts at the left inset', () => {
    expect(rects[0]!.x).toBe(CANVAS_EDGE)
    expect(rects[0]!.y).toBe(CANVAS_EDGE)
    expect(rects[0]!.width).toBe(700)
  })

  it('each column follows the previous width plus the gap', () => {
    expect(rects[2]!.x).toBe(CANVAS_EDGE + 700 + PANE_GAP)
    expect(rects[3]!.x).toBe(CANVAS_EDGE + 700 + PANE_GAP + 500 + PANE_GAP)
  })

  it('pane heights plus gaps fill the column', () => {
    const column = rects.filter((r) => r.columnId === 'c1')
    const total = column.reduce((a, r) => a + r.height, 0) + PANE_GAP * (column.length - 1)
    expect(total).toBeCloseTo(columnHeightIn(H), 6)
  })

  it('each pane follows the one above plus the gap', () => {
    expect(rects[1]!.y).toBeCloseTo(rects[0]!.y + rects[0]!.height + PANE_GAP, 6)
  })

  it('a lone pane fills the column height', () => {
    expect(rects[2]!.height).toBeCloseTo(columnHeightIn(H), 6)
  })
})

describe('paneRects — folded panes', () => {
  const folded = createLayout([
    {
      id: 'c1',
      width: 700,
      panes: [
        { id: 'p1', title: 'a', heightRatio: 0.5 },
        { id: 'p2', title: 'b', heightRatio: 0.2, minimized: true },
        { id: 'p3', title: 'c', heightRatio: 0.3 },
      ],
    },
  ])
  const rects = paneRects(folded, H)
  const rect = (id: string): Rect => rects.find((r) => r.paneId === id)!

  it('gives a folded pane the fixed bar height', () => {
    expect(rect('p2').height).toBe(FOLD_BAR_HEIGHT)
  })

  it('shares what the bar leaves among the expanded panes, by their ratios', () => {
    const room = columnContentHeight(columnHeightIn(H), 3) - FOLD_BAR_HEIGHT
    expect(rect('p1').height).toBeCloseTo(room * (0.5 / 0.8), 6)
    expect(rect('p3').height).toBeCloseTo(room * (0.3 / 0.8), 6)
  })

  it('still fills the column, gaps included', () => {
    const total = rects.reduce((a, r) => a + r.height, 0) + PANE_GAP * 2
    expect(total).toBeCloseTo(columnHeightIn(H), 6)
  })

  it('stacks a fully folded column from the top and leaves the rest empty', () => {
    const all = createLayout([
      {
        id: 'c1',
        width: 700,
        panes: [
          { id: 'p1', title: 'a', minimized: true },
          { id: 'p2', title: 'b', minimized: true },
        ],
      },
    ])
    const bars = paneRects(all, H)
    expect(bars.map((r) => r.height)).toEqual([FOLD_BAR_HEIGHT, FOLD_BAR_HEIGHT])
    expect(bars[0]!.y).toBe(CANVAS_EDGE)
    expect(bars[1]!.y).toBe(CANVAS_EDGE + FOLD_BAR_HEIGHT + PANE_GAP)
    // The floor of the column is a long way below the last bar: empty canvas.
    expect(bars[1]!.y + bars[1]!.height).toBeLessThan(columnHeightIn(H))
  })

  it('gives the expanded panes nothing rather than a negative height', () => {
    const tight = paneRects(folded, FOLD_BAR_HEIGHT + CANVAS_EDGE)
    expect(tight.every((r) => r.height >= 0)).toBe(true)
  })
})

describe('scrollToReveal', () => {
  const rects = paneRects(layout, H)
  const vp = (scrollX: number, width = 800) => ({ width, height: H, scrollX })

  it('does not scroll when already visible', () => {
    expect(scrollToReveal(rects, 'a1', vp(0), layout)).toBeNull()
  })

  it('aligns a pane past the right edge to the right', () => {
    // The column is 900px; the viewport must exceed it to align right.
    const target = rects.find((r) => r.paneId === 'c1p')!
    expect(scrollToReveal(rects, 'c1p', vp(0, 1000), layout)).toBe(
      target.x + target.width + CANVAS_EDGE - 1000,
    )
  })

  it('aligns a pane past the left edge to the left', () => {
    expect(scrollToReveal(rects, 'a1', vp(900), layout)).toBe(0)
  })

  it('aligns a pane wider than the viewport to the left', () => {
    const narrow = vp(0, 400)
    const target = rects.find((r) => r.paneId === 'c1p')!
    expect(scrollToReveal(rects, 'c1p', narrow, layout)).toBe(target.x - CANVAS_EDGE)
  })

  it('never scrolls past the canvas', () => {
    const result = scrollToReveal(rects, 'c1p', vp(0), layout)!
    expect(result).toBeLessThanOrEqual(maxScrollX(layout, 800))
  })

  it('returns null for an unknown pane', () => {
    expect(scrollToReveal(rects, 'nope', vp(0), layout)).toBeNull()
  })

  /*
   * The case Alt+P walks into: a column widened all the way to the cap is
   * exactly viewport-sized with its insets, so it must land whole rather than
   * fall into the wider-than-the-viewport branch and hang off the right edge.
   */
  it('a column at the width cap lands fully inside the viewport', () => {
    const view = 1000
    const capped = createLayout([
      { id: 'c1', width: 400, panes: [{ id: 'p1', title: 'a' }] },
      { id: 'c2', width: maxColumnWidth(view), panes: [{ id: 'p2', title: 'b' }] },
      { id: 'c3', width: 400, panes: [{ id: 'p3', title: 'c' }] },
    ])
    const cappedRects = paneRects(capped, H)
    const target = cappedRects.find((r) => r.paneId === 'p2')!
    const scrollX = scrollToReveal(cappedRects, 'p2', vp(0, view), capped)!
    expect(target.x - scrollX).toBe(CANVAS_EDGE)
    expect(target.x + target.width - scrollX).toBe(view - CANVAS_EDGE)
  })
})

describe('visiblePaneIds', () => {
  const rects = paneRects(layout, H)

  it('the active region spans one viewport either side', () => {
    // Active region [-300, 600): only c1 overlaps.
    expect(visiblePaneIds(rects, { width: 300, height: H, scrollX: 0 })).toEqual(['a1', 'a2'])
  })

  it('any overlap counts as visible', () => {
    // Active region [-700, 1400): c3 clips the right edge at x=1218.
    const ids = visiblePaneIds(rects, { width: 700, height: H, scrollX: 0 })
    expect(ids).toContain('c1p')
  })

  it('scrolling far drops the panes left behind', () => {
    const ids = visiblePaneIds(rects, { width: 300, height: H, scrollX: 1500 })
    expect(ids).not.toContain('a1')
  })
})

describe('snapToDevicePixels', () => {
  it('rounds to whole CSS pixels at 1× and 2×', () => {
    expect(snapToDevicePixels(10.4, 1)).toBe(10)
    expect(snapToDevicePixels(10.26, 2)).toBe(10.5)
  })

  it('lands on a device pixel at fractional scales', () => {
    const dpr = 5 / 3
    const snapped = snapToDevicePixels(184, dpr)
    expect(Math.abs(snapped * dpr - Math.round(snapped * dpr))).toBeLessThan(1e-9)
    expect(Math.abs(snapped - 184)).toBeLessThan(1 / dpr)
  })

  it('treats a missing ratio as 1×', () => {
    expect(snapToDevicePixels(3.7, 0)).toBe(4)
  })
})
