import { describe, expect, it } from 'vitest'
import { barNeighbours } from './bar-neighbours'
import { createLayout, focusDir, type ColumnSeed, type Layout } from './layout-model'

const HEIGHT = 600
const none = (): boolean => false

function layoutOf(seeds: readonly ColumnSeed[], focused: string): Layout {
  return { ...createLayout(seeds), focusedPaneId: focused }
}

const single = (id: string, title = id): ColumnSeed => ({ id: `c-${id}`, panes: [{ id, title }] })

describe('barNeighbours', () => {
  it('names the column on each side of the focused one', () => {
    const layout = layoutOf([single('a'), single('b'), single('c')], 'b')
    const { left, right } = barNeighbours(layout, HEIGHT, none)
    expect(left).toEqual({ paneId: 'a', title: 'a', beyond: 0, wants: false })
    expect(right).toEqual({ paneId: 'c', title: 'c', beyond: 0, wants: false })
  })

  it('counts the columns past each neighbour', () => {
    const layout = layoutOf([single('a'), single('b'), single('c'), single('d'), single('e')], 'b')
    const { left, right } = barNeighbours(layout, HEIGHT, none)
    expect(left?.beyond).toBe(0)
    expect(right?.paneId).toBe('c')
    expect(right?.beyond).toBe(2)
  })

  it('leaves a side empty at the end of the canvas', () => {
    const layout = layoutOf([single('a'), single('b')], 'a')
    const { left, right } = barNeighbours(layout, HEIGHT, none)
    expect(left).toBeNull()
    expect(right?.paneId).toBe('b')
  })

  it('has no sides with one column', () => {
    const layout = layoutOf([{ id: 'c1', panes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }] }], 'a')
    expect(barNeighbours(layout, HEIGHT, none)).toEqual({ left: null, right: null })
  })

  it('picks the pane a focus move would land on in a split column', () => {
    const layout = layoutOf(
      [
        { id: 'c1', panes: [{ id: 'top', title: 'top', heightRatio: 0.2 }, { id: 'bottom', title: 'bottom', heightRatio: 0.8 }] },
        single('b'),
      ],
      'b',
    )
    const { left } = barNeighbours(layout, HEIGHT, none)
    expect(left?.paneId).toBe(focusDir(layout, 'left', HEIGHT).focusedPaneId)
    expect(left?.paneId).toBe('bottom')
  })

  it('agrees with focusDir when the neighbour column has a folded pane', () => {
    const layout = layoutOf(
      [
        { id: 'c1', panes: [{ id: 'x', title: 'x', minimized: true }, { id: 'y', title: 'y' }, { id: 'z', title: 'z' }] },
        single('b'),
      ],
      'b',
    )
    expect(barNeighbours(layout, HEIGHT, none).left?.paneId).toBe(
      focusDir(layout, 'left', HEIGHT).focusedPaneId,
    )
  })

  it('marks a side when any pane on it wants attention, however far out', () => {
    const layout = layoutOf([single('a'), single('b'), single('c'), single('d')], 'b')
    const { left, right } = barNeighbours(layout, HEIGHT, (id) => id === 'd')
    expect(left?.wants).toBe(false)
    expect(right?.wants).toBe(true)
  })

  it('does not count the focused column as either side', () => {
    const layout = layoutOf(
      [single('a'), { id: 'c2', panes: [{ id: 'b', title: 'b' }, { id: 'b2', title: 'b2' }] }, single('c')],
      'b',
    )
    const { left, right } = barNeighbours(layout, HEIGHT, (id) => id === 'b2')
    expect(left?.wants).toBe(false)
    expect(right?.wants).toBe(false)
  })

  it('passes the layout title through untouched', () => {
    const layout = layoutOf([single('a', 'shell'), single('b')], 'b')
    expect(barNeighbours(layout, HEIGHT, none).left?.title).toBe('shell')
  })
})
