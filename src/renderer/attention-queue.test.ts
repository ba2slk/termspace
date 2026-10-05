import { describe, expect, it } from 'vitest'
import { formatClock, notificationText, prune, upsert, type QueuedNotification } from './attention-queue'

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

describe('formatClock', () => {
  const at = (hh: number, mm: number): number => new Date(2026, 9, 5, hh, mm).getTime()

  it('writes local 24h time, zero-padded', () => {
    expect(formatClock(at(14, 32))).toBe('14:32')
    expect(formatClock(at(9, 5))).toBe('09:05')
  })

  it('reads midnight as 00:00 and the last minute as 23:59', () => {
    expect(formatClock(at(0, 0))).toBe('00:00')
    expect(formatClock(at(23, 59))).toBe('23:59')
  })
})

describe('notificationText', () => {
  it('joins title and body with a colon', () => {
    expect(notificationText('Done', 'build finished')).toBe('Done: build finished')
  })

  it('shows whichever is there when the other is empty', () => {
    expect(notificationText('', 'build finished')).toBe('build finished')
    expect(notificationText('Done', '')).toBe('Done')
  })

  it('is empty when both are', () => {
    expect(notificationText('', '')).toBe('')
  })
})
