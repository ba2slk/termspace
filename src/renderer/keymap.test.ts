import { describe, expect, it } from 'vitest'
import { isAppAction, resolveAction, type KeyChord } from './keymap'
import { DEFAULT_BINDINGS, DEFAULT_BINDINGS_MAC, DIGIT_CODE, withChords } from '../shared/keybindings'

const chord = (code: string, mods: Partial<KeyChord> = {}): KeyChord => ({
  code,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
})

describe('resolveAction — focus movement', () => {
  it('Alt+arrow moves focus in all four directions', () => {
    expect(resolveAction(chord('ArrowLeft', { altKey: true }))).toEqual({ t: 'focus', dir: 'left' })
    expect(resolveAction(chord('ArrowRight', { altKey: true }))).toEqual({
      t: 'focus',
      dir: 'right',
    })
    expect(resolveAction(chord('ArrowUp', { altKey: true }))).toEqual({ t: 'focus', dir: 'up' })
    expect(resolveAction(chord('ArrowDown', { altKey: true }))).toEqual({ t: 'focus', dir: 'down' })
  })
})

describe('resolveAction — layout changes', () => {
  it('Alt+Shift+arrow splits in all four directions', () => {
    const mods = { altKey: true, shiftKey: true }
    expect(resolveAction(chord('ArrowDown', mods))).toEqual({ t: 'split', side: 'down' })
    expect(resolveAction(chord('ArrowUp', mods))).toEqual({ t: 'split', side: 'up' })
    expect(resolveAction(chord('ArrowRight', mods))).toEqual({ t: 'add-column', side: 'right' })
    expect(resolveAction(chord('ArrowLeft', mods))).toEqual({ t: 'add-column', side: 'left' })
  })

  it('Alt+Shift+W closes the pane', () => {
    expect(resolveAction(chord('KeyW', { altKey: true, shiftKey: true }))).toEqual({
      t: 'close-pane',
    })
  })

  it('unbound Alt+Shift combinations pass through', () => {
    expect(resolveAction(chord('KeyB', { altKey: true, shiftKey: true }))).toBeNull()
    expect(resolveAction(chord('Enter', { altKey: true, shiftKey: true }))).toBeNull()
  })

  it('Alt+Shift+U I O P moves the pane, in the resize keys\' vim order', () => {
    const mods = { altKey: true, shiftKey: true }
    expect(resolveAction(chord('KeyU', mods))).toEqual({ t: 'move', dir: 'left' })
    expect(resolveAction(chord('KeyI', mods))).toEqual({ t: 'move', dir: 'down' })
    expect(resolveAction(chord('KeyO', mods))).toEqual({ t: 'move', dir: 'up' })
    expect(resolveAction(chord('KeyP', mods))).toEqual({ t: 'move', dir: 'right' })
  })

  it('moving needs a session, so it is not an app action', () => {
    expect(isAppAction({ t: 'move', dir: 'left' })).toBe(false)
  })
})

describe('resolveAction — resizing', () => {
  it('Ctrl+Alt+arrow resizes', () => {
    expect(resolveAction(chord('ArrowRight', { ctrlKey: true, altKey: true }))).toEqual({
      t: 'resize',
      dir: 'right',
    })
    expect(resolveAction(chord('ArrowUp', { ctrlKey: true, altKey: true }))).toEqual({
      t: 'resize',
      dir: 'up',
    })
  })

  it('Alt+U I O P resizes, in vim order', () => {
    const pairs = [
      ['KeyU', 'left'],
      ['KeyI', 'down'],
      ['KeyO', 'up'],
      ['KeyP', 'right'],
    ] as const
    for (const [code, dir] of pairs) {
      expect(resolveAction(chord(code, { altKey: true }))).toEqual({ t: 'resize', dir })
    }
  })

  it('leaves those keys to the shell with other modifiers', () => {
    expect(resolveAction(chord('KeyU', { ctrlKey: true }))).toBeNull()
    expect(resolveAction(chord('KeyP', { ctrlKey: true, altKey: true, shiftKey: true }))).toBeNull()
  })
})

describe('resolveAction — other bindings', () => {
  it('Alt+S toggles the sidebar', () => {
    expect(resolveAction(chord('KeyS', { altKey: true }))).toEqual({ t: 'toggle-sidebar' })
  })

  it('Alt+Shift+S saves the layout, and Alt+S is still the sidebar', () => {
    expect(resolveAction(chord('KeyS', { altKey: true, shiftKey: true }))).toEqual({
      t: 'save-layout',
    })
    expect(resolveAction(chord('KeyS', { altKey: true }))).toEqual({ t: 'toggle-sidebar' })
  })

  it('Alt+M opens the overview', () => {
    expect(resolveAction(chord('KeyM', { altKey: true }))).toEqual({ t: 'overview' })
  })

  it('Alt+G scrolls back to the focused pane', () => {
    expect(resolveAction(chord('KeyG', { altKey: true }))).toEqual({ t: 'reveal-focus' })
  })

  it('Alt+F and Alt+B stay with the shell', () => {
    expect(resolveAction(chord('KeyF', { altKey: true }))).toBeNull()
    expect(resolveAction(chord('KeyB', { altKey: true }))).toBeNull()
  })

  it('Alt+Z zooms the focused pane', () => {
    expect(resolveAction(chord('KeyZ', { altKey: true }))).toEqual({ t: 'zoom' })
  })

  it('zoom acts on the focused pane, so it is not an app action', () => {
    expect(isAppAction({ t: 'zoom' })).toBe(false)
  })

  it('Alt+D folds the focused pane', () => {
    expect(resolveAction(chord('KeyD', { altKey: true }))).toEqual({ t: 'fold' })
  })

  it('folding acts on the focused pane, so it is not an app action', () => {
    expect(isAppAction({ t: 'fold' })).toBe(false)
  })

  it('reveal-focus needs a session, so it is not an app action', () => {
    expect(isAppAction({ t: 'reveal-focus' })).toBe(false)
  })

  it('overview needs a session, so it is not an app action', () => {
    expect(isAppAction({ t: 'overview' })).toBe(false)
  })

  it('F11 toggles fullscreen', () => {
    expect(resolveAction(chord('F11'))).toEqual({ t: 'fullscreen' })
  })

  it('modified F11 passes through', () => {
    expect(resolveAction(chord('F11', { ctrlKey: true }))).toBeNull()
  })

  it('Ctrl+Shift+F opens scrollback search', () => {
    expect(resolveAction(chord('KeyF', { ctrlKey: true, shiftKey: true }))).toEqual({ t: 'search' })
  })

  it('search needs a focused pane, so it is not an app action', () => {
    expect(isAppAction({ t: 'search' })).toBe(false)
  })

  it('Ctrl+Shift+C and V copy and paste', () => {
    expect(resolveAction(chord('KeyC', { ctrlKey: true, shiftKey: true }))).toEqual({ t: 'copy' })
    expect(resolveAction(chord('KeyV', { ctrlKey: true, shiftKey: true }))).toEqual({ t: 'paste' })
  })
})

describe('resolveAction — font size', () => {
  it('Ctrl+= and Ctrl+- step the font size', () => {
    expect(resolveAction(chord('Equal', { ctrlKey: true }))).toEqual({ t: 'font-size', delta: 1 })
    expect(resolveAction(chord('Minus', { ctrlKey: true }))).toEqual({ t: 'font-size', delta: -1 })
  })

  it('Ctrl+Shift+= means Ctrl++ on layouts where + is shifted', () => {
    expect(resolveAction(chord('Equal', { ctrlKey: true, shiftKey: true }))).toEqual({
      t: 'font-size',
      delta: 1,
    })
  })

  it('accepts the numpad twins', () => {
    expect(resolveAction(chord('NumpadAdd', { ctrlKey: true }))).toEqual({
      t: 'font-size',
      delta: 1,
    })
    expect(resolveAction(chord('NumpadSubtract', { ctrlKey: true }))).toEqual({
      t: 'font-size',
      delta: -1,
    })
  })

  it('Ctrl+0 resets to the default size', () => {
    expect(resolveAction(chord('Digit0', { ctrlKey: true }))).toEqual({ t: 'font-reset' })
    expect(resolveAction(chord('Numpad0', { ctrlKey: true }))).toEqual({ t: 'font-reset' })
  })

  it('bare and Alt-modified keys pass through', () => {
    expect(resolveAction(chord('Equal'))).toBeNull()
    expect(resolveAction(chord('Minus'))).toBeNull()
    expect(resolveAction(chord('Equal', { ctrlKey: true, altKey: true }))).toBeNull()
  })

  it('belongs to the app, so it works with no session open', () => {
    expect(isAppAction({ t: 'font-size', delta: 1 })).toBe(true)
    expect(isAppAction({ t: 'font-reset' })).toBe(true)
  })
})

describe('resolveAction — keys that must pass through', () => {
  it('bare keys always pass through', () => {
    for (const code of ['KeyA', 'ArrowLeft', 'Enter', 'Tab', 'Escape', 'KeyC']) {
      expect(resolveAction(chord(code))).toBeNull()
    }
  })

  it('leaves the shell word motions alone', () => {
    expect(resolveAction(chord('KeyB', { altKey: true }))).toBeNull()
    expect(resolveAction(chord('KeyF', { altKey: true }))).toBeNull()
  })

  it('never intercepts Ctrl+C', () => {
    expect(resolveAction(chord('KeyC', { ctrlKey: true }))).toBeNull()
  })

  it('anything with Super belongs to the window manager', () => {
    expect(resolveAction(chord('ArrowLeft', { altKey: true, metaKey: true }))).toBeNull()
    expect(resolveAction(chord('KeyS', { altKey: true, metaKey: true }))).toBeNull()
  })

  it('Ctrl+arrow passes through', () => {
    expect(resolveAction(chord('ArrowLeft', { ctrlKey: true }))).toBeNull()
  })

  it('undefined triple modifiers pass through', () => {
    expect(resolveAction(chord('ArrowRight', { ctrlKey: true, altKey: true, shiftKey: true }))).toBeNull()
  })
})

describe('isAppAction — app versus session', () => {
  const resolve = (code: string, mods: Partial<KeyChord> = {}): boolean => {
    const action = resolveAction(chord(code, mods))
    if (action === null) throw new Error(`${code} did not resolve to an action`)
    return isAppAction(action)
  }

  it('sidebar, settings and fullscreen belong to the app', () => {
    // These still mean something with no session open.
    expect(resolve('KeyS', { altKey: true })).toBe(true)
    expect(resolve('Comma', { ctrlKey: true })).toBe(true)
    expect(resolve('F11')).toBe(true)
    // Needs a session, but writes its file rather than touching a pane.
    expect(resolve('KeyS', { altKey: true, shiftKey: true })).toBe(true)
  })

  it('anything needing a focused pane belongs to the session', () => {
    expect(resolve('ArrowRight', { altKey: true })).toBe(false)
    expect(resolve('ArrowDown', { altKey: true, shiftKey: true })).toBe(false)
    expect(resolve('ArrowLeft', { altKey: true, shiftKey: true })).toBe(false)
    expect(resolve('KeyW', { altKey: true, shiftKey: true })).toBe(false)
    expect(resolve('ArrowUp', { ctrlKey: true, altKey: true })).toBe(false)
    expect(resolve('KeyC', { ctrlKey: true, shiftKey: true })).toBe(false)
    expect(resolve('KeyV', { ctrlKey: true, shiftKey: true })).toBe(false)
  })
})

describe('resolveAction — session shortcuts', () => {
  it('Alt+1 through Alt+9 jump to that session', () => {
    expect(resolveAction(chord('Digit1', { altKey: true }))).toEqual({ t: 'goto-session', index: 0 })
    expect(resolveAction(chord('Digit9', { altKey: true }))).toEqual({ t: 'goto-session', index: 8 })
  })

  it('accepts the numpad twins', () => {
    expect(resolveAction(chord('Numpad3', { altKey: true }))).toEqual({ t: 'goto-session', index: 2 })
  })

  it('leaves Alt+0 unbound', () => {
    expect(resolveAction(chord('Digit0', { altKey: true }))).toBeNull()
  })

  it('passes bare and shifted digits through to the terminal', () => {
    expect(resolveAction(chord('Digit1'))).toBeNull()
    expect(resolveAction(chord('Digit1', { altKey: true, shiftKey: true }))).toBeNull()
    expect(resolveAction(chord('Digit1', { ctrlKey: true }))).toBeNull()
  })

  it('belongs to the app, so it works with no session open', () => {
    expect(isAppAction({ t: 'goto-session', index: 0 })).toBe(true)
  })

  it('Alt+Shift+< and Alt+Shift+> step through the open sessions', () => {
    expect(resolveAction(chord('Comma', { altKey: true, shiftKey: true }))).toEqual({
      t: 'step-session',
      delta: -1,
    })
    expect(resolveAction(chord('Period', { altKey: true, shiftKey: true }))).toEqual({
      t: 'step-session',
      delta: 1,
    })
  })

  it('leaves the unshifted comma and period to the terminal', () => {
    expect(resolveAction(chord('Comma', { altKey: true }))).toBeNull()
    expect(resolveAction(chord('Period', { altKey: true }))).toBeNull()
  })

  it('stepping belongs to the app too', () => {
    expect(isAppAction({ t: 'step-session', delta: 1 })).toBe(true)
  })
})

describe('resolveAction — rebound', () => {
  const rebind = (id: Parameters<typeof withChords>[1], chords: readonly string[]) =>
    withChords(DEFAULT_BINDINGS, id, chords)

  it('follows the bindings it is given', () => {
    const bindings = rebind('overview', ['Ctrl+Shift+KeyM'])
    expect(resolveAction(chord('KeyM', { ctrlKey: true, shiftKey: true }), bindings)).toEqual({
      t: 'overview',
    })
    // And the old key goes back to the terminal.
    expect(resolveAction(chord('KeyM', { altKey: true }), bindings)).toBeNull()
  })

  it('takes a key the terminal would rather have, once asked to', () => {
    const bindings = rebind('copy', ['Ctrl+KeyC'])
    expect(resolveAction(chord('KeyC', { ctrlKey: true }), bindings)).toEqual({ t: 'copy' })
  })

  it('leaves an emptied action unbound', () => {
    expect(resolveAction(chord('KeyM', { altKey: true }), rebind('overview', []))).toBeNull()
  })

  it('rebinds all nine session jumps together', () => {
    const bindings = rebind('goto-session', [`Ctrl+Shift+${DIGIT_CODE}`])
    expect(resolveAction(chord('Digit4', { ctrlKey: true, shiftKey: true }), bindings)).toEqual({
      t: 'goto-session',
      index: 3,
    })
    expect(resolveAction(chord('Digit4', { altKey: true }), bindings)).toBeNull()
  })

  it('gives the first claimant a chord two actions want', () => {
    // 'search' comes before 'toggle-sidebar' in the action order.
    const bindings = rebind('search', ['Alt+KeyS'])
    expect(resolveAction(chord('KeyS', { altKey: true }), bindings)).toEqual({ t: 'search' })
  })
})

describe('resolveAction — mac mode', () => {
  it('resolves a Cmd chord', () => {
    expect(
      resolveAction(chord('ArrowLeft', { metaKey: true }), DEFAULT_BINDINGS_MAC, true),
    ).toEqual({ t: 'focus', dir: 'left' })
  })

  it('lets Option+letter fall through to the pty', () => {
    expect(resolveAction(chord('KeyU', { altKey: true }), DEFAULT_BINDINGS_MAC, true)).toBeNull()
  })

  it('still refuses Meta off mac, where it is Super', () => {
    expect(resolveAction(chord('ArrowLeft', { metaKey: true }), DEFAULT_BINDINGS_MAC)).toBeNull()
  })
})
