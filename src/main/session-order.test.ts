import { describe, expect, it } from 'vitest'
import { applyOrder, moveTo, parseOrder, renameInOrder } from './session-order'

const item = (id: string, createdMs: number) => ({ id, createdMs })

describe('parseOrder', () => {
  it('reads an array of ids', () => {
    expect(parseOrder(['a', 'b'])).toEqual(['a', 'b'])
  })
  it('drops non-strings, blanks and duplicates', () => {
    expect(parseOrder(['a', 1, '', 'a', null, 'b'])).toEqual(['a', 'b'])
  })
  it('reads anything else as no order at all', () => {
    expect(parseOrder(null)).toEqual([])
    expect(parseOrder({ order: ['a'] })).toEqual([])
    expect(parseOrder('a,b')).toEqual([])
  })
})

describe('applyOrder', () => {
  it('places known ids at their recorded position', () => {
    const items = [item('a', 3), item('b', 2), item('c', 1)]
    expect(applyOrder(items, ['c', 'a', 'b']).map((i) => i.id)).toEqual(['c', 'a', 'b'])
  })

  it('appends unknown ids by creation time, oldest first', () => {
    const items = [item('new', 500), item('old', 100), item('known', 999)]
    expect(applyOrder(items, ['known']).map((i) => i.id)).toEqual(['known', 'old', 'new'])
  })

  it('breaks a creation-time tie by id, so the order never flickers', () => {
    const items = [item('b', 100), item('a', 100)]
    expect(applyOrder(items, []).map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('ignores recorded ids that have no file', () => {
    expect(applyOrder([item('a', 1)], ['gone', 'a']).map((i) => i.id)).toEqual(['a'])
  })

  it('with no order at all, falls back to creation time', () => {
    const items = [item('b', 200), item('a', 100)]
    expect(applyOrder(items, []).map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('moveTo', () => {
  it('moves a row down', () => {
    expect(moveTo(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
  })
  it('moves a row up', () => {
    expect(moveTo(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
  })
  it('clamps past either end', () => {
    expect(moveTo(['a', 'b', 'c'], 'b', 99)).toEqual(['a', 'c', 'b'])
    expect(moveTo(['a', 'b', 'c'], 'b', -5)).toEqual(['b', 'a', 'c'])
  })
  it('is a no-op for an id it does not hold', () => {
    expect(moveTo(['a', 'b'], 'zz', 0)).toEqual(['a', 'b'])
  })
  it('leaves the order alone when the index does not change', () => {
    expect(moveTo(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c'])
  })
})

describe('renameInOrder', () => {
  it('keeps the index', () => {
    expect(renameInOrder(['a', 'b', 'c'], 'b', 'z')).toEqual(['a', 'z', 'c'])
  })
  it('does nothing when the old id is not recorded', () => {
    expect(renameInOrder(['a'], 'b', 'z')).toEqual(['a'])
  })
  it('drops the old entry when the new id is already recorded', () => {
    expect(renameInOrder(['a', 'b'], 'a', 'b')).toEqual(['b'])
  })
})
