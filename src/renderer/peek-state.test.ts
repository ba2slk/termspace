import { describe, expect, it } from 'vitest'
import { isPeekKey, nextPeek } from './peek-state'

describe('isPeekKey', () => {
  it('is Alt off mac and Cmd on it', () => {
    expect(isPeekKey('AltLeft', false)).toBe(true)
    expect(isPeekKey('AltRight', false)).toBe(true)
    expect(isPeekKey('MetaLeft', false)).toBe(false)

    expect(isPeekKey('MetaLeft', true)).toBe(true)
    expect(isPeekKey('MetaRight', true)).toBe(true)
    expect(isPeekKey('AltLeft', true)).toBe(false)
  })
})

describe('nextPeek', () => {
  it('goes on with the modifier down and off when it comes up', () => {
    expect(nextPeek(false, { t: 'keydown', code: 'AltLeft' }, false)).toBe(true)
    expect(nextPeek(true, { t: 'keyup', code: 'AltLeft' }, false)).toBe(false)
  })

  it('ignores every other key, so a chord does not end the hold', () => {
    expect(nextPeek(true, { t: 'keydown', code: 'ArrowLeft' }, false)).toBe(true)
    expect(nextPeek(true, { t: 'keyup', code: 'ArrowLeft' }, false)).toBe(true)
    expect(nextPeek(false, { t: 'keydown', code: 'KeyA' }, false)).toBe(false)
  })

  it('lets go when the window does', () => {
    expect(nextPeek(true, { t: 'blur' }, false)).toBe(false)
    expect(nextPeek(false, { t: 'blur' }, false)).toBe(false)
  })

  it('a held Alt means nothing on mac, where the chord is Cmd', () => {
    expect(nextPeek(false, { t: 'keydown', code: 'AltLeft' }, true)).toBe(false)
    expect(nextPeek(false, { t: 'keydown', code: 'MetaLeft' }, true)).toBe(true)
  })
})
