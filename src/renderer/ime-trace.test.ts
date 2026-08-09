import { describe, expect, it } from 'vitest'
import { ImeTrace } from './ime-trace'

describe('ImeTrace', () => {
  it('flags the same Hangul sent twice within the window', () => {
    const trace = new ImeTrace()
    expect(trace.recordData(1000, '가')).toBe(false)
    expect(trace.recordData(1050, '가')).toBe(true)
  })

  it('ignores repeats outside the window', () => {
    const trace = new ImeTrace()
    trace.recordData(1000, '가')
    expect(trace.recordData(1500, '가')).toBe(false)
  })

  it('ignores non-Hangul repeats — key repeat is honest typing', () => {
    const trace = new ImeTrace()
    trace.recordData(1000, 'a')
    expect(trace.recordData(1010, 'a')).toBe(false)
  })

  it('ignores different syllables in quick succession', () => {
    const trace = new ImeTrace()
    trace.recordData(1000, '가')
    expect(trace.recordData(1050, '나')).toBe(false)
  })

  it('keeps only the newest entries', () => {
    const trace = new ImeTrace(3)
    for (let i = 0; i < 5; i += 1) trace.record(i, 'keydown', String(i))
    expect(trace.dump().map((e) => e.detail)).toEqual(['2', '3', '4'])
  })
})
