import { describe, expect, it } from 'vitest'
import { isLinkActivation } from './link-activation'

const click = (over: Partial<{ ctrlKey: boolean; metaKey: boolean; button: number }> = {}) => ({
  ctrlKey: false,
  metaKey: false,
  button: 0,
  ...over,
})

describe('isLinkActivation', () => {
  it('opens on Ctrl+click off mac', () => {
    expect(isLinkActivation(click({ ctrlKey: true }), false)).toBe(true)
  })

  it('opens on Cmd+click on mac', () => {
    expect(isLinkActivation(click({ metaKey: true }), true)).toBe(true)
  })

  it('leaves a plain click to the selection', () => {
    expect(isLinkActivation(click(), false)).toBe(false)
    expect(isLinkActivation(click(), true)).toBe(false)
  })

  it('takes the other platform\'s modifier as no modifier at all', () => {
    expect(isLinkActivation(click({ metaKey: true }), false)).toBe(false)
    // Ctrl+click is the context menu on mac.
    expect(isLinkActivation(click({ ctrlKey: true }), true)).toBe(false)
  })

  it('ignores the middle and right buttons', () => {
    expect(isLinkActivation(click({ ctrlKey: true, button: 1 }), false)).toBe(false)
    expect(isLinkActivation(click({ ctrlKey: true, button: 2 }), false)).toBe(false)
    expect(isLinkActivation(click({ metaKey: true, button: 1 }), true)).toBe(false)
  })
})
