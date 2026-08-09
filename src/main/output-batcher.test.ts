import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutputBatcher } from './output-batcher'

const flushed: Array<[string, string]> = []
const paused: string[] = []
const resumed: string[] = []
let batcher: OutputBatcher

beforeEach(() => {
  vi.useFakeTimers()
  flushed.length = 0
  paused.length = 0
  resumed.length = 0
  batcher = new OutputBatcher({
    flushIntervalMs: 16,
    highWaterMarkChars: 100,
    onFlush: (paneId, data) => flushed.push([paneId, data]),
    onPause: (paneId) => paused.push(paneId),
    onResume: (paneId) => resumed.push(paneId),
  })
})

afterEach(() => {
  batcher.dispose()
  vi.useRealTimers()
})

describe('OutputBatcher', () => {
  it('coalesces a frame of chunks into one flush', () => {
    batcher.push('a', 'ab')
    batcher.push('a', 'cd')
    expect(flushed).toEqual([])
    vi.advanceTimersByTime(16)
    expect(flushed).toEqual([['a', 'abcd']])
  })

  it('buffers each pane separately', () => {
    batcher.push('a', 'x')
    batcher.push('b', 'y')
    vi.advanceTimersByTime(16)
    expect([...flushed].sort()).toEqual([
      ['a', 'x'],
      ['b', 'y'],
    ])
  })

  it('flushes nothing when there is nothing to send', () => {
    vi.advanceTimersByTime(160)
    expect(flushed).toEqual([])
  })

  it('sends the next frame after a flush', () => {
    batcher.push('a', '1')
    vi.advanceTimersByTime(16)
    batcher.push('a', '2')
    vi.advanceTimersByTime(16)
    expect(flushed).toEqual([
      ['a', '1'],
      ['a', '2'],
    ])
  })

  it('flushes immediately past the high-water mark', () => {
    batcher.push('a', 'x'.repeat(150))
    expect(flushed).toHaveLength(1)
  })

  it('pauses the pty past the high-water mark', () => {
    batcher.push('a', 'x'.repeat(150))
    expect(paused).toEqual(['a'])
  })

  it('resumes a paused pty after flushing', () => {
    batcher.push('a', 'x'.repeat(150))
    vi.advanceTimersByTime(16)
    expect(resumed).toEqual(['a'])
  })

  it('one noisy pane does not pause the others', () => {
    batcher.push('flood', 'x'.repeat(150))
    batcher.push('calm', 'hi')
    expect(paused).toEqual(['flood'])
    vi.advanceTimersByTime(16)
    expect(flushed.some(([id, data]) => id === 'calm' && data === 'hi')).toBe(true)
  })

  it('flushPane sends one pane without waiting', () => {
    batcher.push('a', 'bye')
    batcher.push('b', 'stay')
    batcher.flushPane('a')
    expect(flushed).toEqual([['a', 'bye']])
  })

  it('discards buffered output for a dropped pane', () => {
    batcher.push('a', 'x')
    batcher.drop('a')
    vi.advanceTimersByTime(16)
    expect(flushed).toEqual([])
  })

  it('leaves no timer behind after dispose', () => {
    batcher.push('a', 'x')
    batcher.dispose()
    vi.advanceTimersByTime(1000)
    expect(flushed).toEqual([])
  })
})
