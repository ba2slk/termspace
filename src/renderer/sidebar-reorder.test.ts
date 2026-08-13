import { describe, expect, it } from 'vitest'
import { dropIndexAt, type RowBox } from './sidebar-reorder'

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
