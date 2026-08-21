import { describe, expect, it } from 'vitest'
import {
  addColumn,
  closePane,
  columnContentHeight,
  createLayout,
  DEFAULT_COLUMN_WIDTH,
  expandedRatioSum,
  expandedRoom,
  findPane,
  focusDir,
  layoutViolations,
  MIN_COLUMN_WIDTH,
  MIN_PANE_HEIGHT,
  movePane,
  PANE_GAP,
  renamePane,
  resizeColumn,
  resizePane,
  setMinimized,
  splitDown,
  splitPane,
  toggleMinimized,
  type ColumnSeed,
} from './layout-model'

const twoColumns: ColumnSeed[] = [
  { id: 'c1', width: 720, panes: [{ id: 'p1', title: 'editor' }, { id: 'p2', title: 'shell' }] },
  { id: 'c2', panes: [{ id: 'p3', title: 'server' }] },
]

describe('columnContentHeight', () => {
  it('subtracts the inter-pane gaps', () => {
    expect(columnContentHeight(1000, 1)).toBe(1000)
    expect(columnContentHeight(1000, 3)).toBe(1000 - PANE_GAP * 2)
  })
})

describe('createLayout', () => {
  it('distributes evenly when no ratios are given', () => {
    const layout = createLayout(twoColumns)
    expect(layout.columns[0]!.panes.map((p) => p.heightRatio)).toEqual([0.5, 0.5])
    expect(layout.columns[1]!.panes[0]!.heightRatio).toBe(1)
  })

  it('honours explicit ratios, normalised to 1', () => {
    const layout = createLayout([
      {
        id: 'c1',
        panes: [
          { id: 'p1', title: 'a', heightRatio: 0.6 },
          { id: 'p2', title: 'b', heightRatio: 0.6 },
        ],
      },
    ])
    const ratios = layout.columns[0]!.panes.map((p) => p.heightRatio)
    expect(ratios[0]).toBeCloseTo(0.5, 9)
    expect(ratios[1]).toBeCloseTo(0.5, 9)
  })

  it('defaults the width and lifts anything below the minimum', () => {
    const layout = createLayout([
      { id: 'c1', panes: [{ id: 'p1', title: 'a' }] },
      { id: 'c2', width: 10, panes: [{ id: 'p2', title: 'b' }] },
    ])
    expect(layout.columns[0]!.width).toBe(640)
    expect(layout.columns[1]!.width).toBe(240)
  })

  it('focuses the first pane and centres desiredY on it', () => {
    const layout = createLayout(twoColumns)
    expect(layout.focusedPaneId).toBe('p1')
    expect(layout.desiredY).toBeCloseTo(0.25, 9)
  })

  it('throws with no columns', () => {
    expect(() => createLayout([])).toThrow()
  })

  it('throws on a column with no panes', () => {
    expect(() => createLayout([{ id: 'c1', panes: [] }])).toThrow()
  })
})

describe('layoutViolations', () => {
  it('reports nothing for a sound layout', () => {
    expect(layoutViolations(createLayout(twoColumns))).toEqual([])
  })

  it('catches ratios that do not total 1', () => {
    const broken = {
      columns: [{ id: 'c1', width: 640, panes: [{ id: 'p1', title: 'a', heightRatio: 0.4 }] }],
      focusedPaneId: 'p1',
      desiredY: 0.5,
    }
    expect(layoutViolations(broken)).toHaveLength(1)
    expect(layoutViolations(broken)[0]).toContain('height ratios')
  })

  it('catches focus on a missing pane', () => {
    const broken = { ...createLayout(twoColumns), focusedPaneId: 'nope' }
    expect(layoutViolations(broken)[0]).toContain('focus')
  })

  it('catches duplicate ids', () => {
    const broken = createLayout([
      { id: 'c1', panes: [{ id: 'dup', title: 'a' }] },
      { id: 'c2', panes: [{ id: 'dup', title: 'b' }] },
    ])
    expect(layoutViolations(broken).some((v) => v.includes('duplicate'))).toBe(true)
  })
})

describe('findPane', () => {
  it('returns the pane along with its position', () => {
    const found = findPane(createLayout(twoColumns), 'p3')
    expect(found).not.toBeNull()
    expect(found!.columnIndex).toBe(1)
    expect(found!.paneIndex).toBe(0)
    expect(found!.pane.title).toBe('server')
  })

  it('returns null when absent', () => {
    expect(findPane(createLayout(twoColumns), 'nope')).toBeNull()
  })
})

describe('constants', () => {
  it('the minimum pane height fits three rows plus padding', () => {
    expect(MIN_PANE_HEIGHT).toBeGreaterThanOrEqual(3 * 18)
  })
})

describe('splitDown', () => {
  const base = createLayout([{ id: 'c1', panes: [{ id: 'p1', title: 'editor' }] }])

  it('halves the target and inserts below it', () => {
    const next = splitDown(base, 'p1', 1000, { id: 'p2', title: 'shell' })
    expect(next.columns[0]!.panes.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(next.columns[0]!.panes.map((p) => p.heightRatio)).toEqual([0.5, 0.5])
    expect(layoutViolations(next)).toEqual([])
  })

  it('inserts directly below a middle pane', () => {
    const three = createLayout([
      {
        id: 'c1',
        panes: [
          { id: 'a', title: 'a' },
          { id: 'b', title: 'b' },
          { id: 'c', title: 'c' },
        ],
      },
    ])
    const next = splitDown(three, 'b', 1000, { id: 'new', title: 'n' })
    expect(next.columns[0]!.panes.map((p) => p.id)).toEqual(['a', 'b', 'new', 'c'])
  })

  it('moves focus to the new pane and centres desiredY', () => {
    const next = splitDown(base, 'p1', 1000, { id: 'p2', title: 'shell' })
    expect(next.focusedPaneId).toBe('p2')
    expect(next.desiredY).toBeCloseTo(0.75, 9)
  })

  it('refuses a split that would breach the minimum height', () => {
    const next = splitDown(base, 'p1', 90, { id: 'p2', title: 'shell' })
    expect(next).toBe(base)
  })

  it('refuses a split that would push a sibling below the minimum', () => {
    // 158px to share between three; one must fall below the minimum.
    const two = createLayout([
      { id: 'c1', panes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }] },
    ])
    expect(splitDown(two, 'a', 170, { id: 'n', title: 'n' })).toBe(two)
  })

  /*
   * Splitting the bar itself. Folding is a deliberate choice and a split is not
   * a request to undo it, so the runtime hands the folded pane straight to this
   * function: the bar keeps its flag and half of its dormant ratio, and the new
   * pane arrives open beside it with the other half.
   */
  it('splitting a folded pane leaves it folded and opens only the new one', () => {
    const two = createLayout([
      { id: 'c1', panes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }] },
    ])
    const folded = setMinimized(two, 'b', true)
    const next = splitDown(folded, 'b', 1000, { id: 'n', title: 'n' })
    const panes = next.columns[0]!.panes
    expect(panes.map((p) => p.id)).toEqual(['a', 'b', 'n'])
    expect(findPane(next, 'b')!.pane.minimized).toBe(true)
    expect(findPane(next, 'n')!.pane.minimized).toBeUndefined()
    // Half each, exactly as a split of an open pane divides it.
    expect(findPane(next, 'b')!.pane.heightRatio).toBeCloseTo(0.25, 9)
    expect(findPane(next, 'n')!.pane.heightRatio).toBeCloseTo(0.25, 9)
    expect(next.focusedPaneId).toBe('n')
    expect(layoutViolations(next)).toEqual([])
  })

  it('refuses to split a bar whose half could not be opened again', () => {
    const two = createLayout([
      { id: 'c1', panes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }] },
    ])
    const folded = setMinimized(two, 'b', true)
    /*
     * As drawn this split fits: the bar costs 30px and the new pane clears the
     * minimum in what is left. It is refused on the other geometry alone —
     * opening the bar afterwards would put its own quarter under the minimum.
     */
    expect(splitDown(folded, 'b', 250, { id: 'n', title: 'n' })).toBe(folded)
  })

  /*
   * The bar's 30px is on loan. A split that only fits while a neighbour is
   * folded would come apart the moment it opens, so both geometries have to
   * hold before the pane is cut in half.
   */
  it('refuses a split that only fits while a neighbour is folded', () => {
    const two = createLayout([
      { id: 'c1', panes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }] },
    ])
    const folded = setMinimized(two, 'b', true)
    expect(splitDown(folded, 'a', 224, { id: 'n', title: 'n' })).toBe(folded)
  })

  it('still allows a split both geometries can hold', () => {
    const two = createLayout([
      { id: 'c1', panes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }] },
    ])
    const folded = setMinimized(two, 'b', true)
    const next = splitDown(folded, 'a', 1000, { id: 'n', title: 'n' })
    expect(next.columns[0]!.panes.map((p) => p.id)).toEqual(['a', 'n', 'b'])
    expect(layoutViolations(next)).toEqual([])
  })

  it('is a no-op for an unknown pane', () => {
    expect(splitDown(base, 'nope', 1000, { id: 'p2', title: 's' })).toBe(base)
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify(base)
    splitDown(base, 'p1', 1000, { id: 'p2', title: 'shell' })
    expect(JSON.stringify(base)).toBe(before)
  })
})

describe('splitPane — upwards', () => {
  const base = createLayout([
    { id: 'c1', panes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }] },
  ])

  it('inserts directly above the target', () => {
    const next = splitPane(base, 'b', 1000, { id: 'new', title: 'n' }, 'up')
    expect(next.columns[0]!.panes.map((p) => p.id)).toEqual(['a', 'new', 'b'])
    expect(layoutViolations(next)).toEqual([])
  })

  it('splits the original height in half', () => {
    const next = splitPane(base, 'b', 1000, { id: 'new', title: 'n' }, 'up')
    expect(next.columns[0]!.panes.map((p) => p.heightRatio)).toEqual([0.5, 0.25, 0.25])
  })

  it('focuses the new pane and centres desiredY', () => {
    const next = splitPane(base, 'b', 1000, { id: 'new', title: 'n' }, 'up')
    expect(next.focusedPaneId).toBe('new')
    expect(next.desiredY).toBeCloseTo(0.625, 9) // 0.5 + 0.25/2
  })

  it('is a no-op when the minimum height blocks it', () => {
    expect(splitPane(base, 'b', 170, { id: 'n', title: 'n' }, 'up')).toBe(base)
  })
})

describe('addColumn', () => {
  const base = createLayout([
    { id: 'c1', panes: [{ id: 'p1', title: 'a' }] },
    { id: 'c2', panes: [{ id: 'p2', title: 'b' }] },
  ])

  it('inserts a one-pane column to the right', () => {
    const next = addColumn(base, 'c1', { id: 'c3', pane: { id: 'p3', title: 'new' } })
    expect(next.columns.map((c) => c.id)).toEqual(['c1', 'c3', 'c2'])
    expect(next.columns[1]!.panes.map((p) => p.id)).toEqual(['p3'])
    expect(next.columns[1]!.panes[0]!.heightRatio).toBe(1)
    expect(layoutViolations(next)).toEqual([])
  })

  it('uses the default width when none is given', () => {
    const next = addColumn(base, 'c2', { id: 'c3', pane: { id: 'p3', title: 'new' } })
    expect(next.columns[2]!.width).toBe(DEFAULT_COLUMN_WIDTH)
  })

  it('lifts a request below the minimum width', () => {
    const next = addColumn(base, 'c2', { id: 'c3', width: 10, pane: { id: 'p3', title: 'n' } })
    expect(next.columns[2]!.width).toBe(240)
  })

  it('focuses the new pane with desiredY centred', () => {
    const next = addColumn(base, 'c1', { id: 'c3', pane: { id: 'p3', title: 'new' } })
    expect(next.focusedPaneId).toBe('p3')
    expect(next.desiredY).toBe(0.5)
  })

  it('leaves other column widths alone', () => {
    const next = addColumn(base, 'c1', { id: 'c3', pane: { id: 'p3', title: 'n' } })
    expect(next.columns[0]!.width).toBe(base.columns[0]!.width)
    expect(next.columns[2]!.width).toBe(base.columns[1]!.width)
  })

  it('can insert on the left', () => {
    const next = addColumn(base, 'c2', {
      id: 'c3',
      side: 'left',
      pane: { id: 'p3', title: 'new' },
    })
    expect(next.columns.map((c) => c.id)).toEqual(['c1', 'c3', 'c2'])
    expect(layoutViolations(next)).toEqual([])
  })

  it('inserting left of the first column comes first', () => {
    const next = addColumn(base, 'c1', {
      id: 'c3',
      side: 'left',
      pane: { id: 'p3', title: 'new' },
    })
    expect(next.columns.map((c) => c.id)).toEqual(['c3', 'c1', 'c2'])
  })

  it('is a no-op for an unknown column', () => {
    expect(addColumn(base, 'nope', { id: 'c3', pane: { id: 'p3', title: 'n' } })).toBe(base)
  })
})

describe('closePane', () => {
  it('redistributes the ratio proportionally among siblings', () => {
    const layout = createLayout([
      {
        id: 'c1',
        panes: [
          { id: 'a', title: 'a', heightRatio: 0.5 },
          { id: 'b', title: 'b', heightRatio: 0.25 },
          { id: 'c', title: 'c', heightRatio: 0.25 },
        ],
      },
    ])
    const next = closePane(layout, 'b')!
    expect(next.columns[0]!.panes.map((p) => p.id)).toEqual(['a', 'c'])
    // The 0.5 : 0.25 ratio survives renormalisation
    expect(next.columns[0]!.panes[0]!.heightRatio).toBeCloseTo(2 / 3, 9)
    expect(next.columns[0]!.panes[1]!.heightRatio).toBeCloseTo(1 / 3, 9)
    expect(layoutViolations(next)).toEqual([])
  })

  it('removes the column with its last pane', () => {
    const layout = createLayout([
      { id: 'c1', panes: [{ id: 'a', title: 'a' }] },
      { id: 'c2', panes: [{ id: 'b', title: 'b' }] },
    ])
    const next = closePane(layout, 'a')!
    expect(next.columns.map((c) => c.id)).toEqual(['c2'])
    expect(layoutViolations(next)).toEqual([])
  })

  it('returns null for the session\'s last pane', () => {
    const layout = createLayout([{ id: 'c1', panes: [{ id: 'a', title: 'a' }] }])
    expect(closePane(layout, 'a')).toBeNull()
  })

  it('closing an unfocused pane leaves focus alone', () => {
    const layout = createLayout([
      { id: 'c1', panes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }] },
    ])
    expect(closePane(layout, 'b')!.focusedPaneId).toBe('a')
  })

  it('focus moves to the pane below', () => {
    const layout = createLayout([
      {
        id: 'c1',
        panes: [
          { id: 'a', title: 'a' },
          { id: 'b', title: 'b' },
          { id: 'c', title: 'c' },
        ],
      },
    ])
    const focused = { ...layout, focusedPaneId: 'b' }
    expect(closePane(focused, 'b')!.focusedPaneId).toBe('c')
  })

  it('focus moves above when there is nothing below', () => {
    const layout = createLayout([
      { id: 'c1', panes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }] },
    ])
    const focused = { ...layout, focusedPaneId: 'b' }
    expect(closePane(focused, 'b')!.focusedPaneId).toBe('a')
  })

  it('focus crosses to the nearest pane in the column to the right', () => {
    const layout = createLayout([
      { id: 'c1', panes: [{ id: 'a', title: 'a' }] },
      { id: 'c2', panes: [{ id: 'top', title: 't' }, { id: 'bottom', title: 'b' }] },
    ])
    const focused = { ...layout, focusedPaneId: 'a', desiredY: 0.9 }
    expect(closePane(focused, 'a')!.focusedPaneId).toBe('bottom')
  })

  it('falls back to the column on the left', () => {
    const layout = createLayout([
      { id: 'c1', panes: [{ id: 'a', title: 'a' }] },
      { id: 'c2', panes: [{ id: 'b', title: 'b' }] },
    ])
    const focused = { ...layout, focusedPaneId: 'b' }
    expect(closePane(focused, 'b')!.focusedPaneId).toBe('a')
  })

  it('is a no-op for an unknown pane', () => {
    const layout = createLayout([{ id: 'c1', panes: [{ id: 'a', title: 'a' }] }])
    expect(closePane(layout, 'nope')).toBe(layout)
  })

  it('desiredY follows the focused pane\'s new centre', () => {
    // Redistribution moves the focused pane's centre, so desiredY must follow.
    const layout = createLayout([
      {
        id: 'c1',
        panes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }, { id: 'c', title: 'c' }],
      },
    ])
    const focused = { ...layout, focusedPaneId: 'c', desiredY: 5 / 6 }
    const next = closePane(focused, 'a')!
    expect(next.focusedPaneId).toBe('c')
    expect(next.desiredY).toBeCloseTo(0.75, 9) // 3개 중 세 번째(5/6) → 2개 중 두 번째(3/4)
  })

  it('the horizontal round trip still returns after a close', () => {
    const layout = createLayout([
      {
        id: 'c1',
        panes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }, { id: 'c', title: 'c' }],
      },
      { id: 'c2', panes: [{ id: 'x', title: 'x' }, { id: 'y', title: 'y' }] },
    ])
    const focused = { ...layout, focusedPaneId: 'c', desiredY: 5 / 6 }
    const afterClose = closePane(focused, 'a')!
    const round = focusDir(focusDir(afterClose, 'right'), 'left')
    expect(round.focusedPaneId).toBe('c')
  })
})

describe('resizeColumn', () => {
  const base = createLayout([
    { id: 'c1', width: 700, panes: [{ id: 'a', title: 'a' }] },
    { id: 'c2', width: 700, panes: [{ id: 'b', title: 'b' }] },
  ])

  const CAP = 1200

  it('adds to the width', () => {
    expect(resizeColumn(base, 'c1', 120, CAP).columns[0]!.width).toBe(820)
  })

  it('leaves other columns alone; the canvas simply widens', () => {
    expect(resizeColumn(base, 'c1', 120, CAP).columns[1]!.width).toBe(700)
  })

  it('clamps at the minimum width', () => {
    expect(resizeColumn(base, 'c1', -9999, CAP).columns[0]!.width).toBe(MIN_COLUMN_WIDTH)
  })

  it('clamps at the maximum width', () => {
    expect(resizeColumn(base, 'c1', 9999, CAP).columns[0]!.width).toBe(CAP)
  })

  it('is a no-op once the maximum is reached', () => {
    const capped = resizeColumn(base, 'c1', 9999, CAP)
    expect(resizeColumn(capped, 'c1', 40, CAP)).toBe(capped)
  })

  it('holds the minimum when the window is too narrow to hold even one column', () => {
    const narrow = createLayout([{ id: 'c1', width: 260, panes: [{ id: 'a', title: 'a' }] }])
    expect(resizeColumn(narrow, 'c1', -40, 100).columns[0]!.width).toBe(MIN_COLUMN_WIDTH)
  })

  it('never pulls a column that already exceeds the maximum down to it', () => {
    expect(resizeColumn(base, 'c1', 40, 500)).toBe(base)
  })

  it('still narrows a column that exceeds the maximum', () => {
    expect(resizeColumn(base, 'c1', -40, 500).columns[0]!.width).toBe(660)
  })

  it('is a no-op for an unknown column', () => {
    expect(resizeColumn(base, 'nope', 10, CAP)).toBe(base)
  })
})

describe('resizePane', () => {
  const H = 1000
  const base = createLayout([
    { id: 'c1', panes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }] },
  ])

  it('trades height with the pane below, totalling 1', () => {
    const next = resizePane(base, 'a', 100, H)
    const content = columnContentHeight(H, 2)
    expect(next.columns[0]!.panes[0]!.heightRatio).toBeCloseTo(0.5 + 100 / content, 9)
    expect(next.columns[0]!.panes[1]!.heightRatio).toBeCloseTo(0.5 - 100 / content, 9)
    expect(layoutViolations(next)).toEqual([])
  })

  it('moves upwards too', () => {
    const next = resizePane(base, 'a', -100, H)
    expect(next.columns[0]!.panes[0]!.heightRatio).toBeLessThan(0.5)
    expect(layoutViolations(next)).toEqual([])
  })

  it('stops at its own minimum height', () => {
    const next = resizePane(base, 'a', -9999, H)
    const content = columnContentHeight(H, 2)
    expect(next.columns[0]!.panes[0]!.heightRatio * content).toBeCloseTo(MIN_PANE_HEIGHT, 6)
    expect(layoutViolations(next)).toEqual([])
  })

  it('stops at the neighbour\'s minimum height', () => {
    const next = resizePane(base, 'a', 9999, H)
    const content = columnContentHeight(H, 2)
    expect(next.columns[0]!.panes[1]!.heightRatio * content).toBeCloseTo(MIN_PANE_HEIGHT, 6)
  })

  it('resizing the middle of three only affects the one below', () => {
    const three = createLayout([
      {
        id: 'c1',
        panes: [
          { id: 'a', title: 'a' },
          { id: 'b', title: 'b' },
          { id: 'c', title: 'c' },
        ],
      },
    ])
    const next = resizePane(three, 'b', 60, H)
    expect(next.columns[0]!.panes[0]!.heightRatio).toBeCloseTo(1 / 3, 9)
    expect(next.columns[0]!.panes[1]!.heightRatio).toBeGreaterThan(1 / 3)
    expect(next.columns[0]!.panes[2]!.heightRatio).toBeLessThan(1 / 3)
  })

  it('the last pane in a column takes from the one above instead', () => {
    const next = resizePane(base, 'b', 100, H)
    const content = columnContentHeight(H, 2)
    expect(next.columns[0]!.panes[1]!.heightRatio).toBeCloseTo(0.5 + 100 / content, 9)
    expect(next.columns[0]!.panes[0]!.heightRatio).toBeCloseTo(0.5 - 100 / content, 9)
    expect(layoutViolations(next)).toEqual([])
  })

  it('the last pane shrinks on a negative delta, like any other', () => {
    const next = resizePane(base, 'b', -100, H)
    expect(next.columns[0]!.panes[1]!.heightRatio).toBeLessThan(0.5)
    expect(next.columns[0]!.panes[0]!.heightRatio).toBeGreaterThan(0.5)
    expect(layoutViolations(next)).toEqual([])
  })

  it('the last pane stops at the minimum above it', () => {
    const next = resizePane(base, 'b', 9999, H)
    const content = columnContentHeight(H, 2)
    expect(next.columns[0]!.panes[0]!.heightRatio * content).toBeCloseTo(MIN_PANE_HEIGHT, 6)
    expect(layoutViolations(next)).toEqual([])
  })

  it('the only pane in a column cannot be resized', () => {
    const lone = createLayout([{ id: 'c1', panes: [{ id: 'a', title: 'a' }] }])
    expect(resizePane(lone, 'a', 100, H)).toBe(lone)
  })

  it('is a no-op when the pair cannot hold two minimums', () => {
    expect(resizePane(base, 'a', 10, 100)).toBe(base)
  })

  it('is a no-op for an unknown pane', () => {
    expect(resizePane(base, 'nope', 10, H)).toBe(base)
  })

  describe('with a folded neighbour', () => {
    const three = createLayout([
      {
        id: 'c1',
        panes: [
          { id: 'a', title: 'a' },
          { id: 'b', title: 'b' },
          { id: 'c', title: 'c' },
        ],
      },
    ])
    const middleFolded = setMinimized(three, 'b', true)

    it('trades across the bar with the next pane that still has a height', () => {
      const next = resizePane(middleFolded, 'a', 60, H)
      expect(next.columns[0]!.panes[0]!.heightRatio).toBeGreaterThan(1 / 3)
      expect(next.columns[0]!.panes[1]!.heightRatio).toBe(1 / 3) // the bar is untouched
      expect(next.columns[0]!.panes[2]!.heightRatio).toBeLessThan(1 / 3)
      expect(layoutViolations(next)).toEqual([])
    })

    it('moves the pixels the caller asked for, counting only the shared room', () => {
      const next = resizePane(middleFolded, 'a', 60, H)
      const room = expandedRoom(H, middleFolded.columns[0]!.panes)
      const sum = expandedRatioSum(middleFolded.columns[0]!.panes)
      const before = (1 / 3 / sum) * room
      expect((next.columns[0]!.panes[0]!.heightRatio / sum) * room).toBeCloseTo(before + 60, 6)
    })

    it('takes from above when everything below is folded', () => {
      const bottomFolded = setMinimized(three, 'c', true)
      const next = resizePane(bottomFolded, 'b', 60, H)
      expect(next.columns[0]!.panes[1]!.heightRatio).toBeGreaterThan(1 / 3)
      expect(next.columns[0]!.panes[0]!.heightRatio).toBeLessThan(1 / 3)
      expect(next.columns[0]!.panes[2]!.heightRatio).toBe(1 / 3)
    })

    it('refuses to resize a folded pane: a bar has no height to trade', () => {
      expect(resizePane(middleFolded, 'b', 60, H)).toBe(middleFolded)
    })

    it('refuses when no expanded partner is left', () => {
      const alone = setMinimized(setMinimized(three, 'a', true), 'c', true)
      expect(resizePane(alone, 'b', 60, H)).toBe(alone)
    })

    /*
     * Folding hands the column extra room, so a pane clamped against the
     * minimum while a bar is up would fall through it the moment the bar opens.
     * The clamp has to answer for both geometries, not just the one on screen.
     */
    it('clamps so that unfolding cannot leave a pane under the minimum', () => {
      const SHORT = 324
      const folded = setMinimized(three, 'c', true)
      const shrunk = resizePane(folded, 'a', -9999, SHORT)
      const opened = setMinimized(shrunk, 'c', false)
      const content = columnContentHeight(SHORT, 3)
      const heights = opened.columns[0]!.panes.map((p) => p.heightRatio * content)
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(MIN_PANE_HEIGHT - 1e-6)
    })

    it('still clamps to the folded minimum where that is the stricter one', () => {
      // A tall column: the bar frees so little that the on-screen minimum bites
      // first, and the clamp must not be loosened by the other geometry.
      const folded = setMinimized(three, 'c', true)
      const shrunk = resizePane(folded, 'a', -9999, 4000)
      const room = expandedRoom(4000, shrunk.columns[0]!.panes)
      const sum = expandedRatioSum(shrunk.columns[0]!.panes)
      const onScreen = (shrunk.columns[0]!.panes[0]!.heightRatio / sum) * room
      expect(onScreen).toBeGreaterThanOrEqual(MIN_PANE_HEIGHT - 1e-6)
    })
  })
})

describe('focusDir', () => {
  // c1 has two panes (centres 0.25 / 0.75), c2 has three (1/6, 1/2, 5/6)
  const grid = createLayout([
    { id: 'c1', panes: [{ id: 'a1', title: 'a1' }, { id: 'a2', title: 'a2' }] },
    {
      id: 'c2',
      panes: [
        { id: 'b1', title: 'b1' },
        { id: 'b2', title: 'b2' },
        { id: 'b3', title: 'b3' },
      ],
    },
  ])

  it('down moves to the next pane in the column', () => {
    expect(focusDir(grid, 'down').focusedPaneId).toBe('a2')
  })

  it('down at the bottom does nothing', () => {
    const atBottom = { ...grid, focusedPaneId: 'a2' }
    expect(focusDir(atBottom, 'down')).toBe(atBottom)
  })

  it('up at the top does nothing', () => {
    expect(focusDir(grid, 'up')).toBe(grid)
  })

  it('vertical movement updates desiredY', () => {
    expect(focusDir(grid, 'down').desiredY).toBeCloseTo(0.75, 9)
  })

  it('right picks the pane nearest desiredY', () => {
    // desiredY 0.25 is nearer c2's 1/6 than its 1/2
    expect(focusDir(grid, 'right').focusedPaneId).toBe('b1')
  })

  it('right leaves desiredY unchanged', () => {
    const moved = focusDir(grid, 'right')
    expect(moved.desiredY).toBe(grid.desiredY)
  })

  it('down then right lands at the matching height', () => {
    // ↓ sets desiredY 0.75, nearest c2's 5/6
    const moved = focusDir(focusDir(grid, 'down'), 'right')
    expect(moved.focusedPaneId).toBe('b3')
  })

  it('invariant: right then left returns to the start', () => {
    for (const settled of [grid, { ...grid, focusedPaneId: 'a2', desiredY: 0.75 }]) {
      const round = focusDir(focusDir(settled, 'right'), 'left')
      expect(round.focusedPaneId).toBe(settled.focusedPaneId)
    }
  })

  it('invariant: two out and two back returns to the start', () => {
    const three = createLayout([
      { id: 'c1', panes: [{ id: 'a1', title: 'x' }, { id: 'a2', title: 'x' }] },
      { id: 'c2', panes: [{ id: 'b1', title: 'x' }] },
      {
        id: 'c3',
        panes: [
          { id: 'c1p', title: 'x' },
          { id: 'c2p', title: 'x' },
          { id: 'c3p', title: 'x' },
        ],
      },
    ])
    const start = { ...three, focusedPaneId: 'a2', desiredY: 0.75 }
    const there = focusDir(focusDir(start, 'right'), 'right')
    const back = focusDir(focusDir(there, 'left'), 'left')
    expect(back.focusedPaneId).toBe('a2')
  })

  it('left at the first column does nothing', () => {
    expect(focusDir(grid, 'left')).toBe(grid)
  })

  it('right at the last column does nothing', () => {
    const atRight = { ...grid, focusedPaneId: 'b1' }
    expect(focusDir(atRight, 'right')).toBe(atRight)
  })

  it('horizontal movement does nothing with one column', () => {
    const single = createLayout([{ id: 'c1', panes: [{ id: 'a', title: 'a' }] }])
    expect(focusDir(single, 'left')).toBe(single)
    expect(focusDir(single, 'right')).toBe(single)
  })

  it('invariants hold after every movement', () => {
    let layout = grid
    for (const dir of ['down', 'right', 'up', 'left', 'right', 'down'] as const) {
      layout = focusDir(layout, dir)
      expect(layoutViolations(layout)).toEqual([])
    }
  })
})

describe('movePane', () => {
  const HEIGHT = 900

  /** c1: p1(0.7) over p2(0.3); c2: p3 alone. Uneven so slot-swaps are visible. */
  function base() {
    return createLayout([
      {
        id: 'c1',
        width: 720,
        panes: [
          { id: 'p1', title: 'editor', heightRatio: 0.7 },
          { id: 'p2', title: 'shell', heightRatio: 0.3 },
        ],
      },
      { id: 'c2', panes: [{ id: 'p3', title: 'server' }] },
    ])
  }

  it('down swaps identities but leaves the size slots in place', () => {
    const next = movePane(base(), 'down', HEIGHT, 'cx')
    const panes = next.columns[0]!.panes
    expect(panes.map((p) => p.id)).toEqual(['p2', 'p1'])
    expect(panes.map((p) => p.heightRatio)).toEqual([0.7, 0.3])
    expect(next.focusedPaneId).toBe('p1')
    expect(next.desiredY).toBeCloseTo(0.7 + 0.15, 9)
  })

  it('up at the top of the column does nothing', () => {
    const layout = base()
    expect(movePane(layout, 'up', HEIGHT, 'cx')).toBe(layout)
  })

  /*
   * Slots stay put only while both are drawn the same way. Across a bar the
   * moved pane would be handed the folded one's dormant share and shrink on
   * screen, and the bar would forget the height it is holding for later.
   */
  it('stepping past a folded bar carries the ratios with the panes', () => {
    const column = createLayout([
      {
        id: 'c1',
        panes: [
          { id: 'a', title: 'a', heightRatio: 0.5 },
          { id: 'b', title: 'b', heightRatio: 0.2, minimized: true },
          { id: 'c', title: 'c', heightRatio: 0.3 },
        ],
      },
    ])
    const next = movePane({ ...column, focusedPaneId: 'a' }, 'down', HEIGHT, 'cx')
    const panes = next.columns[0]!.panes
    expect(panes.map((p) => p.id)).toEqual(['b', 'a', 'c'])
    expect(findPane(next, 'a')!.pane.heightRatio).toBe(0.5)
    expect(findPane(next, 'b')!.pane.heightRatio).toBe(0.2)
    expect(findPane(next, 'b')!.pane.minimized).toBe(true)
    expect(next.focusedPaneId).toBe('a')
    expect(layoutViolations(next)).toEqual([])
  })

  it('a folded pane moved past an open one keeps its dormant share too', () => {
    const column = createLayout([
      {
        id: 'c1',
        panes: [
          { id: 'a', title: 'a', heightRatio: 0.8 },
          { id: 'b', title: 'b', heightRatio: 0.2, minimized: true },
        ],
      },
    ])
    const next = movePane({ ...column, focusedPaneId: 'b' }, 'up', HEIGHT, 'cx')
    expect(next.columns[0]!.panes.map((p) => p.id)).toEqual(['b', 'a'])
    expect(findPane(next, 'b')!.pane.heightRatio).toBe(0.2)
    expect(findPane(next, 'a')!.pane.heightRatio).toBe(0.8)
  })

  it('right steps out into a column of its own rather than joining the neighbour', () => {
    const next = movePane(base(), 'right', HEIGHT, 'cx')
    expect(next.columns.map((c) => c.id)).toEqual(['c1', 'cx', 'c2'])
    expect(next.columns[0]!.panes.map((p) => p.id)).toEqual(['p2'])
    expect(next.columns[0]!.panes[0]!.heightRatio).toBe(1)
    expect(next.columns[1]!.panes.map((p) => p.id)).toEqual(['p1'])
    expect(next.columns[1]!.width).toBe(720)
    expect(next.focusedPaneId).toBe('p1')
    expect(layoutViolations(next)).toEqual([])
  })

  it('stepping out keeps the height the pane left from', () => {
    // Not its new centre (0.5) — the memory is what the next press aims with.
    expect(movePane(base(), 'right', HEIGHT, 'cx').desiredY).toBeCloseTo(0.35, 9)
  })

  it('a second press joins the neighbour above its nearest pane', () => {
    // desiredY is p1's old centre (0.35), above p3's centre (0.5) — insert before.
    const next = movePane(movePane(base(), 'right', HEIGHT, 'cx'), 'right', HEIGHT, 'cy')
    expect(next.columns.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(next.columns[1]!.panes.map((p) => p.id)).toEqual(['p1', 'p3'])
    expect(next.columns[1]!.panes.map((p) => p.heightRatio)).toEqual([0.5, 0.5])
    expect(next.desiredY).toBeCloseTo(0.25, 9)
    expect(layoutViolations(next)).toEqual([])
  })

  it('joins below the nearest pane when coming from underneath', () => {
    const layout = { ...base(), focusedPaneId: 'p2', desiredY: 0.85 }
    const next = movePane(movePane(layout, 'right', HEIGHT, 'cx'), 'right', HEIGHT, 'cy')
    expect(next.columns[1]!.panes.map((p) => p.id)).toEqual(['p3', 'p2'])
  })

  it('two presses out and two back leave the pane where it started', () => {
    let layout = base()
    for (const [dir, id] of [
      ['right', 'cx'],
      ['right', 'cy'],
      ['left', 'cz'],
      ['left', 'cw'],
    ] as const) {
      layout = movePane(layout, dir, HEIGHT, id)
    }
    expect(layout.columns.map((c) => c.panes.map((p) => p.id))).toEqual([['p1', 'p2'], ['p3']])
    expect(layoutViolations(layout)).toEqual([])
  })

  it('a sole pane joining a neighbour takes its column with it', () => {
    const layout = { ...base(), focusedPaneId: 'p3', desiredY: 0.5 }
    const next = movePane(layout, 'left', HEIGHT, 'cx')
    expect(next.columns.map((c) => c.id)).toEqual(['c1'])
    expect(next.columns[0]!.panes).toHaveLength(3)
    expect(next.focusedPaneId).toBe('p3')
    expect(layoutViolations(next)).toEqual([])
  })

  it('steps out past the edge too, where there is no neighbour to join', () => {
    const next = movePane(base(), 'left', HEIGHT, 'cx')
    expect(next.columns.map((c) => c.id)).toEqual(['cx', 'c1', 'c2'])
    expect(next.columns[0]!.panes.map((p) => p.id)).toEqual(['p1'])
    expect(next.columns[1]!.panes.map((p) => p.id)).toEqual(['p2'])
    expect(next.focusedPaneId).toBe('p1')
    expect(layoutViolations(next)).toEqual([])
  })

  it('a pane with siblings steps out rather than being refused by a full column', () => {
    // c2 is full at the minimum, so joining it is impossible — stepping out is not.
    const height = MIN_PANE_HEIGHT * 2 + PANE_GAP
    const layout = createLayout([
      {
        id: 'c1',
        panes: [
          { id: 'p1', title: 'a', heightRatio: 0.5 },
          { id: 'p2', title: 'b', heightRatio: 0.5 },
        ],
      },
      {
        id: 'c2',
        panes: [
          { id: 'p3', title: 'c', heightRatio: 0.5 },
          { id: 'p4', title: 'd', heightRatio: 0.5 },
        ],
      },
    ])
    const next = movePane(layout, 'right', height, 'cx')
    expect(next.columns.map((c) => c.id)).toEqual(['c1', 'cx', 'c2'])
    expect(layoutViolations(next)).toEqual([])
  })

  it('a sole pane at the edge does nothing — it would only recreate itself', () => {
    const layout = { ...base(), focusedPaneId: 'p3', desiredY: 0.5 }
    expect(movePane(layout, 'right', HEIGHT, 'cx')).toBe(layout)
  })

  it('refuses to join a column that cannot fit another pane', () => {
    // c1 holds two panes at exactly the minimum; a third cannot fit.
    const height = MIN_PANE_HEIGHT * 2 + PANE_GAP
    const layout = { ...base(), focusedPaneId: 'p3', desiredY: 0.5 }
    expect(movePane(layout, 'left', height, 'cx')).toBe(layout)
  })

  it('invariants hold across a round trip', () => {
    let layout = base()
    for (const dir of ['right', 'left', 'down', 'up'] as const) {
      layout = movePane(layout, dir, HEIGHT, `n-${dir}`)
      expect(layoutViolations(layout)).toEqual([])
    }
  })
})

describe('toggleMinimized', () => {
  const base = createLayout([
    {
      id: 'c1',
      panes: [
        { id: 'a', title: 'a' },
        { id: 'b', title: 'b' },
        { id: 'c', title: 'c' },
      ],
    },
  ])

  it('folds and unfolds the same pane', () => {
    const folded = toggleMinimized(base, 'b')
    expect(findPane(folded, 'b')?.pane.minimized).toBe(true)
    expect(findPane(toggleMinimized(folded, 'b'), 'b')?.pane.minimized).toBe(false)
  })

  it('leaves the height ratio alone, so unfolding restores it', () => {
    const resized = resizePane(base, 'b', 90, 1000)
    const ratio = findPane(resized, 'b')!.pane.heightRatio
    const round = toggleMinimized(toggleMinimized(resized, 'b'), 'b')
    expect(findPane(round, 'b')?.pane.heightRatio).toBe(ratio)
    expect(layoutViolations(round)).toEqual([])
  })

  it('keeps the ratios totalling 1 while folded', () => {
    expect(layoutViolations(toggleMinimized(base, 'b'))).toEqual([])
    expect(layoutViolations(setMinimized(toggleMinimized(base, 'b'), 'a', true))).toEqual([])
  })

  it('folds every pane in a column without complaint', () => {
    let layout = base
    for (const id of ['a', 'b', 'c']) layout = setMinimized(layout, id, true)
    expect(layout.columns[0]!.panes.every((p) => p.minimized === true)).toBe(true)
    expect(layoutViolations(layout)).toEqual([])
  })

  it('touches neither the focus nor the remembered height', () => {
    const next = toggleMinimized(base, 'b')
    expect(next.focusedPaneId).toBe(base.focusedPaneId)
    expect(next.desiredY).toBe(base.desiredY)
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify(base)
    toggleMinimized(base, 'b')
    expect(JSON.stringify(base)).toBe(before)
  })

  it('leaves the layout as it is when the state already matches', () => {
    expect(setMinimized(base, 'b', false)).toBe(base)
  })

  it('is a no-op for an unknown pane', () => {
    expect(toggleMinimized(base, 'nope')).toBe(base)
  })

  it('is carried in from a seed, so a session file can start folded', () => {
    const seeded = createLayout([
      { id: 'c1', panes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b', minimized: true }] },
    ])
    expect(findPane(seeded, 'a')?.pane.minimized).toBeUndefined()
    expect(findPane(seeded, 'b')?.pane.minimized).toBe(true)
  })
})

describe('renamePane', () => {
  it('renames only the target pane', () => {
    const layout = createLayout([
      { id: 'c1', width: 640, panes: [{ id: 'a', title: 'one' }, { id: 'b', title: 'two' }] },
      { id: 'c2', width: 640, panes: [{ id: 'c', title: 'three' }] },
    ])
    const next = renamePane(layout, 'b', 'renamed')
    expect(findPane(next, 'b')?.pane.title).toBe('renamed')
    expect(findPane(next, 'a')?.pane.title).toBe('one')
    expect(next.columns[1]).toBe(layout.columns[1]) // untouched column keeps its identity
  })
})
