import { describe, expect, it } from 'vitest'
import { dropIndexAt, dropTargetAt, isRestoreDrop, rowShift, type RowBox } from './sidebar-reorder'

// Three 40px rows stacked from y=100.
const rows: RowBox[] = [
  { top: 100, height: 40 },
  { top: 140, height: 40 },
  { top: 180, height: 40 },
]

describe('dropIndexAt', () => {
  it('keeps the row where it is when the pointer has not left it', () => {
    expect(dropIndexAt(120, rows, 0)).toBe(0)
  })

  it('lands after a row once the pointer passes its middle', () => {
    expect(dropIndexAt(165, rows, 0)).toBe(1)
  })

  it('lands before a row while the pointer is above its middle', () => {
    expect(dropIndexAt(145, rows, 2)).toBe(1)
  })

  it('drops to the top above every row', () => {
    expect(dropIndexAt(0, rows, 2)).toBe(0)
  })

  it('drops to the bottom below every row', () => {
    expect(dropIndexAt(999, rows, 0)).toBe(2)
  })

  it('handles an empty list', () => {
    expect(dropIndexAt(10, [], 0)).toBe(0)
  })
})

describe('dropTargetAt', () => {
  // The archive header, 30px tall, sits under the three rows.
  const header: RowBox = { top: 240, height: 30 }

  it('reads as a slot while the pointer is over the list', () => {
    expect(dropTargetAt(165, rows, 0, header)).toEqual({ kind: 'index', index: 1 })
  })

  it('reads as the archive over the header, not as the last slot', () => {
    expect(dropIndexAt(250, rows, 0)).toBe(2) // What the list alone would say.
    expect(dropTargetAt(250, rows, 0, header)).toEqual({ kind: 'archive' })
  })

  it('stays the archive below the header, where nothing else sits', () => {
    expect(dropTargetAt(999, rows, 0, header)).toEqual({ kind: 'archive' })
  })

  it('is a slot again just above the header', () => {
    expect(dropTargetAt(239, rows, 0, header)).toEqual({ kind: 'index', index: 2 })
  })

  it('without a header every position is a slot', () => {
    expect(dropTargetAt(999, rows, 0, null)).toEqual({ kind: 'index', index: 2 })
  })
})

describe('isRestoreDrop', () => {
  const dock = { top: 240, height: 120 }

  it('is a restore once the pointer is above the dock', () => {
    expect(isRestoreDrop(200, dock)).toBe(true)
  })

  it('is not a restore anywhere inside the dock, top edge included', () => {
    expect(isRestoreDrop(240, dock)).toBe(false)
    expect(isRestoreDrop(300, dock)).toBe(false)
    expect(isRestoreDrop(999, dock)).toBe(false)
  })

  it('an unmeasurable dock restores nothing', () => {
    expect(isRestoreDrop(0, null)).toBe(false)
  })
})

describe('rowShift', () => {
  it('nothing moves while the row is over its own slot', () => {
    expect([0, 1, 2, 3].map((i) => rowShift(i, 1, 1))).toEqual([0, 0, 0, 0])
  })
  it('dragging down: the rows it passes step up one slot', () => {
    expect([0, 1, 2, 3].map((i) => rowShift(i, 0, 2))).toEqual([0, -1, -1, 0])
  })
  it('dragging up: the rows it passes step down one slot', () => {
    expect([0, 1, 2, 3].map((i) => rowShift(i, 3, 1))).toEqual([0, 1, 1, 0])
  })
  it('to the very top and the very bottom', () => {
    expect([0, 1, 2].map((i) => rowShift(i, 2, 0))).toEqual([1, 1, 0])
    expect([0, 1, 2].map((i) => rowShift(i, 0, 2))).toEqual([0, -1, -1])
  })
})
