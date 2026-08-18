import { describe, expect, it } from 'vitest'
import { decideBudget, MAX_WEBGL_CONTEXTS, type BudgetState } from './renderer-budget'

const state = (over: Partial<BudgetState> = {}): BudgetState => ({
  allPaneIds: over.visible ?? [],
  visible: [],
  frozen: [],
  attached: [],
  focusedPaneId: 'p0',
  lastSeen: new Map(),
  ...over,
})

describe('decideBudget — attach and detach', () => {
  it('attaches a visible pane that has no renderer', () => {
    const d = decideBudget(state({ visible: ['a', 'b'], focusedPaneId: 'a' }))
    expect([...d.attach].sort()).toEqual(['a', 'b'])
    expect(d.detach).toEqual([])
  })

  // Swapping renderers is visible: the DOM and WebGL cell widths differ, so a
  // pane that comes back reflows and redraws. Under the cap there is no reason
  // to pay that on every scroll.
  it('keeps the renderer of a pane out of view while there is room', () => {
    const d = decideBudget(state({ visible: ['a'], attached: ['a', 'b'], focusedPaneId: 'a' }))
    expect(d.detach).toEqual([])
    expect(d.attach).toEqual([])
  })

  it('gives idle renderers up only to make room, least recently seen first', () => {
    const lastSeen = new Map([
      ['old', 1],
      ['new', 5],
    ])
    const d = decideBudget(
      state({
        visible: ['a'],
        attached: ['old', 'new'],
        focusedPaneId: 'a',
        lastSeen,
        limit: 2,
      }),
    )
    expect(d.attach).toEqual(['a'])
    expect(d.detach).toEqual(['old'])
  })

  it('a visible pane outranks any idle renderer', () => {
    const d = decideBudget(
      state({ visible: ['a', 'b'], attached: ['idle'], focusedPaneId: 'a', limit: 2 }),
    )
    expect([...d.attach].sort()).toEqual(['a', 'b'])
    expect(d.detach).toEqual(['idle'])
  })

  it('does not re-attach what is already attached', () => {
    const d = decideBudget(state({ visible: ['a'], attached: ['a'], focusedPaneId: 'a' }))
    expect(d.attach).toEqual([])
    expect(d.detach).toEqual([])
  })
})

describe('decideBudget — an inactive session', () => {
  // Rebuilding a context costs tens of milliseconds, and a switch away is not
  // by itself a reason to pay it. The page ledger takes the slots when short.
  it('keeps the contexts it holds', () => {
    const d = decideBudget(
      state({
        allPaneIds: ['a', 'b'],
        visible: ['a', 'b'],
        attached: ['a', 'b'],
        focusedPaneId: 'a',
        active: false,
      }),
    )
    expect(d.detach).toEqual([])
    expect(d.attach).toEqual([])
  })

  it('attaches nothing, however visible its panes measure', () => {
    const d = decideBudget(
      state({ allPaneIds: ['a'], visible: ['a'], focusedPaneId: 'a', active: false }),
    )
    expect(d.attach).toEqual([])
  })
})

describe('decideBudget — cap and LRU', () => {
  const many = Array.from({ length: 20 }, (_, i) => `p${i}`)

  it('stays within the cap', () => {
    const d = decideBudget(state({ visible: many, focusedPaneId: 'p0' }))
    expect(d.attach).toHaveLength(MAX_WEBGL_CONTEXTS)
  })

  it('always attaches the focused pane', () => {
    const lastSeen = new Map(many.map((id, i) => [id, i])) // p19가 가장 최근
    const d = decideBudget(state({ visible: many, focusedPaneId: 'p0', lastSeen }))
    expect(d.attach).toContain('p0')
  })

  it('evicts the least recently seen first', () => {
    const lastSeen = new Map([
      ['old', 1],
      ['mid', 5],
      ['new', 9],
    ])
    const d = decideBudget(
      state({
        visible: ['old', 'mid', 'new'],
        attached: ['old', 'mid', 'new'],
        focusedPaneId: 'new',
        lastSeen,
        limit: 2,
      }),
    )
    expect(d.detach).toEqual(['old'])
  })

  it('is deterministic: same input, same output', () => {
    const s = state({ visible: many, focusedPaneId: 'p3' })
    expect(decideBudget(s)).toEqual(decideBudget(s))
  })
})

describe('decideBudget — freeze and thaw', () => {
  it('thaws a frozen pane that is visible', () => {
    const d = decideBudget(
      state({ allPaneIds: ['a', 'b'], visible: ['a', 'b'], frozen: ['b'], focusedPaneId: 'a' }),
    )
    expect(d.thaw).toEqual(['b'])
    expect(d.freeze).toEqual([])
  })

  it('freezes an awake pane that is out of view', () => {
    const d = decideBudget(state({ allPaneIds: ['a', 'b'], visible: ['a'], focusedPaneId: 'a' }))
    expect(d.freeze).toEqual(['b'])
    expect(d.thaw).toEqual([])
  })

  it('freezes panes never yet seen, as at startup', () => {
    // Skipping the freeze on an empty previous set leaves off-screen panes awake.
    const d = decideBudget(
      state({ allPaneIds: ['a', 'b', 'c'], visible: ['a'], frozen: [], focusedPaneId: 'a' }),
    )
    expect([...d.freeze].sort()).toEqual(['b', 'c'])
  })

  it('does not re-freeze what is already frozen', () => {
    const d = decideBudget(
      state({ allPaneIds: ['a', 'b'], visible: ['a'], frozen: ['b'], focusedPaneId: 'a' }),
    )
    expect(d.freeze).toEqual([])
    expect(d.thaw).toEqual([])
  })

  it('never freezes the focused pane, even off screen', () => {
    // Frozen, typed output queues out of sight of both screen and clipboard.
    const d = decideBudget(
      state({ allPaneIds: ['a', 'b', 'c'], visible: ['a'], focusedPaneId: 'c' }),
    )
    expect(d.freeze).toEqual(['b'])
  })

  it('thaws a frozen pane when it takes focus', () => {
    const d = decideBudget(
      state({ allPaneIds: ['a', 'b'], visible: ['a'], frozen: ['b'], focusedPaneId: 'b' }),
    )
    expect(d.thaw).toEqual(['b'])
  })

  it('leaves a continuously visible pane alone', () => {
    const d = decideBudget(state({ allPaneIds: ['a'], visible: ['a'], focusedPaneId: 'a' }))
    expect(d.thaw).toEqual([])
    expect(d.freeze).toEqual([])
  })

  it('a pane over the cap keeps its output, unfrozen', () => {
    const many = Array.from({ length: 20 }, (_, i) => `p${i}`)
    const d = decideBudget(state({ allPaneIds: many, visible: many, focusedPaneId: 'p0' }))
    expect(d.freeze).toEqual([])
    expect(d.attach).toHaveLength(MAX_WEBGL_CONTEXTS)
  })
})
