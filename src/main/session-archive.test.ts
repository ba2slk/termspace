import { describe, expect, it } from 'vitest'
import { markArchived, parseArchive, withArchived, withoutArchived } from './session-archive'

describe('parseArchive', () => {
  it('reads an array of ids', () => {
    expect(parseArchive(['a', 'b'])).toEqual(['a', 'b'])
  })
  it('drops non-strings, blanks and duplicates', () => {
    expect(parseArchive(['a', 1, '', 'a', null, 'b'])).toEqual(['a', 'b'])
  })
  it('reads anything else as nothing archived', () => {
    expect(parseArchive(null)).toEqual([])
    expect(parseArchive({ archived: ['a'] })).toEqual([])
    expect(parseArchive('a,b')).toEqual([])
  })
})

describe('withArchived', () => {
  it('appends the id', () => {
    expect(withArchived(['a'], 'b')).toEqual(['a', 'b'])
  })
  it('archiving twice changes nothing', () => {
    expect(withArchived(['a', 'b'], 'b')).toEqual(['a', 'b'])
  })
})

describe('withoutArchived', () => {
  it('removes the id', () => {
    expect(withoutArchived(['a', 'b'], 'a')).toEqual(['b'])
  })
  it('is a no-op for an id it does not hold', () => {
    expect(withoutArchived(['a'], 'zz')).toEqual(['a'])
  })
})

describe('markArchived', () => {
  it('flags the recorded ids and only those', () => {
    const items = [{ id: 'a' }, { id: 'b' }]
    expect(markArchived(items, ['b'])).toEqual([
      { id: 'a', archived: false },
      { id: 'b', archived: true },
    ])
  })
  it('ignores recorded ids with no item, rather than inventing one', () => {
    expect(markArchived([{ id: 'a' }], ['gone'])).toEqual([{ id: 'a', archived: false }])
  })
})
