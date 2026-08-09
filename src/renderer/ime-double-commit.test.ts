import { describe, expect, it } from 'vitest'
import { ImeDoubleCommitGuard } from './ime-double-commit'

describe('ImeDoubleCommitGuard', () => {
  it('lets an ordinary composition through', () => {
    const guard = new ImeDoubleCommitGuard()
    guard.compositionstart()
    guard.keydown(229)
    guard.keydown(229)
    expect(guard.compositionend()).toBe(false)
  })

  it('swallows the end after a real key code interrupted the composition', () => {
    const guard = new ImeDoubleCommitGuard()
    guard.compositionstart()
    guard.keydown(229)
    guard.keydown(65)
    expect(guard.compositionend()).toBe(true)
  })

  it('keeps composing through modifiers and CapsLock', () => {
    const guard = new ImeDoubleCommitGuard()
    guard.compositionstart()
    for (const code of [16, 17, 18, 20]) guard.keydown(code)
    expect(guard.compositionend()).toBe(false)
  })

  it('does not carry a swallow into the next composition', () => {
    const guard = new ImeDoubleCommitGuard()
    guard.compositionstart()
    guard.keydown(65)
    expect(guard.compositionend()).toBe(true)

    guard.compositionstart()
    guard.keydown(229)
    expect(guard.compositionend()).toBe(false)
  })

  it('ignores keys pressed while nothing is being composed', () => {
    const guard = new ImeDoubleCommitGuard()
    guard.keydown(65)
    guard.compositionstart()
    expect(guard.compositionend()).toBe(false)
  })
})
