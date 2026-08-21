import { describe, expect, it } from 'vitest'
import { CANVAS_BOTTOM, CANVAS_EDGE, canvasWidth, paneRects } from './layout-geometry'
import { createLayout, focusDir, FOLD_BAR_HEIGHT, setMinimized } from './layout-model'
import {
  clampStripOffset,
  columnAtLensCenter,
  columnSnapOffset,
  landingScrollX,
  lensOnStrip,
  lensRect,
  MAX_OVERVIEW_SCALE,
  MIN_OVERVIEW_COLUMN_PX,
  MIN_OVERVIEW_LABEL_PX,
  MIN_OVERVIEW_ROW_PX,
  fitsALabel,
  fitsAName,
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

  /*
   * At a clamped end the lens centre sits before the first column's centre. A
   * step measured from the raw centre snaps to the column already framed, so
   * the press moves the strip a little and the selection never advances.
   */
  it('advances even when the lens centre trails the framed column', () => {
    const stuck = centred(40)
    expect(columnAtLensCenter(cards, stuck, lens)).toBe('c1')
    expect(columnSnapOffset(cards, stuck, 'right', lens)).toBeCloseTo(centred(200))
  })

  it('steps back even when the lens centre leads the framed column', () => {
    const stuck = centred(360)
    expect(columnAtLensCenter(cards, stuck, lens)).toBe('c3')
    expect(columnSnapOffset(cards, stuck, 'left', lens)).toBeCloseTo(centred(200))
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

/*
 * A folded pane is a bar on screen, and the map is a picture of what is on
 * screen, so its row is a bar too — proportionally, in its real slot. The row
 * ends up far too short to carry text at map scale, which is the same problem a
 * column too narrow to label has, and it gets the same answer: the row keeps its
 * true height and gives up its text rather than inflating into a lie.
 */
describe('overviewLayout — folded panes', () => {
  const folded = setMinimized(
    createLayout([
      {
        id: 'c1',
        width: 700,
        panes: [
          { id: 'a1', title: 'editor', heightRatio: 0.5 },
          { id: 'a2', title: 'shell', heightRatio: 0.5 },
        ],
      },
    ]),
    'a2',
    true,
  )
  const overview = overviewLayout(folded, viewport)
  const card = (id: string) => overview.cards.find((c) => c.paneId === id)!

  it('draws the folded pane as the bar it is, scaled like everything else', () => {
    expect(card('a2').height).toBeCloseTo(FOLD_BAR_HEIGHT * overview.scale, 6)
  })

  it('leaves it in its real slot, under the pane above it', () => {
    expect(card('a2').y).toBeGreaterThan(card('a1').y + card('a1').height - 1)
  })

  it('reports the row as one that cannot carry the full card', () => {
    expect(fitsALabel(card('a2').height)).toBe(false)
    expect(fitsALabel(card('a1').height)).toBe(true)
  })

  it('does not inflate the row to fit a label', () => {
    expect(card('a2').height).toBeLessThan(MIN_OVERVIEW_LABEL_PX)
  })

  /*
   * The bar is a fixed 30px and the map never scales past a half, so a folded
   * row is at most 15px — it can never reach the height a stacked card needs.
   * Measuring it against that height alone left every folded pane anonymous at
   * every scale, which is what made the map useless. A folded pane is one line
   * on the canvas, and one line is what its row has to carry here too.
   */
  it('still has room for the pane\'s name, which is all the bar carries anyway', () => {
    expect(FOLD_BAR_HEIGHT * MAX_OVERVIEW_SCALE).toBeLessThan(MIN_OVERVIEW_LABEL_PX)
    expect(fitsAName(card('a2').height)).toBe(true)
  })

  it('gives up the name only where even one line will not fit', () => {
    expect(fitsAName(MIN_OVERVIEW_ROW_PX - 1)).toBe(false)
    const tiny = overviewLayout(folded, { width: 300, height: 600, scrollX: 0 })
    const row = tiny.cards.find((c) => c.paneId === 'a2')!
    expect(fitsAName(row.height)).toBe(false)
  })
})

describe('overviewLayout — sanity against layout-geometry', () => {
  it('the map width is the canvas width shrunk by the scale', () => {
    const overview = overviewLayout(layout, viewport)
    expect(overview.width).toBeCloseTo(canvasWidth(layout) * overview.scale)
  })
})
