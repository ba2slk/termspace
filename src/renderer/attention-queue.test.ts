import { describe, expect, it } from 'vitest'
import { prune, upsert, type QueuedNotification } from './attention-queue'

function entry(paneId: string, at = 1, title = '', body = ''): QueuedNotification {
  return { paneId, title, body, at }
}

describe('upsert', () => {
  it('appends new panes in arrival order', () => {
    let queue: readonly QueuedNotification[] = []
    queue = upsert(queue, entry('a'))
    queue = upsert(queue, entry('b'))
    queue = upsert(queue, entry('c'))
    expect(queue.map((e) => e.paneId)).toEqual(['a', 'b', 'c'])
  })

  it('refreshes a queued pane in place, keeping its turn', () => {
    const queue = [entry('a', 1, 'old', 'old body'), entry('b', 2)]
    const next = upsert(queue, entry('a', 9, 'new', 'new body'))
    expect(next).toEqual([entry('a', 9, 'new', 'new body'), entry('b', 2)])
  })

  it('does not mutate its input', () => {
    const queue = Object.freeze([Object.freeze(entry('a', 1, 'old'))])
    const appended = upsert(queue, entry('b'))
    const refreshed = upsert(queue, entry('a', 5, 'new'))
    expect(queue).toEqual([entry('a', 1, 'old')])
    expect(appended).not.toBe(queue)
    expect(refreshed).not.toBe(queue)
  })
})

describe('prune', () => {
  it('removes only the panes that stopped waiting, keeping order', () => {
    const queue = [entry('a'), entry('b'), entry('c'), entry('d')]
    const next = prune(queue, (id) => id === 'a' || id === 'c')
    expect(next.map((e) => e.paneId)).toEqual(['a', 'c'])
  })

  it('returns the same array when nothing is removed', () => {
    const queue = [entry('a'), entry('b')]
    expect(prune(queue, () => true)).toBe(queue)
    const empty: readonly QueuedNotification[] = []
    expect(prune(empty, () => false)).toBe(empty)
  })

  it('does not mutate its input', () => {
    const queue = Object.freeze([entry('a'), entry('b')])
    const next = prune(queue, (id) => id === 'b')
    expect(queue.map((e) => e.paneId)).toEqual(['a', 'b'])
    expect(next).not.toBe(queue)
  })
})
