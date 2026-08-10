import { describe, expect, it } from 'vitest'
import {
  ACTION_GROUPS,
  ACTION_IDS,
  chordFromEvent,
  chordRisk,
  changedBindings,
  DEFAULT_BINDINGS,
  DEFAULT_BINDINGS_MAC,
  defaultBindingsFor,
  DIGIT_CODE,
  digitIndex,
  findConflicts,
  formatChord,
  isDefault,
  MAX_CHORDS,
  normalizeBindings,
  parseChord,
  withChords,
  type KeyChord,
} from './keybindings'

const press = (code: string, mods: Partial<KeyChord> = {}): KeyChord => ({
  code,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
})

describe('chordFromEvent', () => {
  it('writes the modifiers in a fixed order', () => {
    expect(chordFromEvent(press('KeyU', { shiftKey: true, ctrlKey: true, altKey: true }))).toBe(
      'Ctrl+Alt+Shift+KeyU',
    )
  })

  it('anything with Super belongs to the window manager', () => {
    expect(chordFromEvent(press('KeyS', { altKey: true, metaKey: true }))).toBeNull()
  })

  it('a bare modifier is not a chord', () => {
    expect(chordFromEvent(press('ShiftLeft', { shiftKey: true }))).toBeNull()
    expect(chordFromEvent(press('AltLeft', { altKey: true }))).toBeNull()
  })

  it('collapses the nine digits and their numpad twins onto one code', () => {
    expect(chordFromEvent(press('Digit1', { altKey: true }))).toBe(`Alt+${DIGIT_CODE}`)
    expect(chordFromEvent(press('Numpad9', { altKey: true }))).toBe(`Alt+${DIGIT_CODE}`)
  })

  it('leaves zero alone — it is not a session', () => {
    expect(chordFromEvent(press('Digit0', { ctrlKey: true }))).toBe('Ctrl+Digit0')
  })
})

describe('digitIndex', () => {
  it('is zero-based, and only for one through nine', () => {
    expect(digitIndex('Digit1')).toBe(0)
    expect(digitIndex('Numpad3')).toBe(2)
    expect(digitIndex('Digit9')).toBe(8)
    expect(digitIndex('Digit0')).toBeNull()
    expect(digitIndex('KeyA')).toBeNull()
  })
})

describe('parseChord', () => {
  it('accepts a canonical chord unchanged', () => {
    expect(parseChord('Ctrl+Shift+KeyF')).toBe('Ctrl+Shift+KeyF')
  })

  it('forgives modifier order and case', () => {
    expect(parseChord('shift+CONTROL+KeyF')).toBe('Ctrl+Shift+KeyF')
    expect(parseChord('  option+KeyU  ')).toBe('Alt+KeyU')
  })

  it('rejects an unknown code, so a typo cannot silently unbind a key', () => {
    expect(parseChord('Alt+Banana')).toBeNull()
    expect(parseChord('Alt+u')).toBeNull()
    expect(parseChord('')).toBeNull()
    expect(parseChord(42)).toBeNull()
  })

  it('rejects Super rather than dropping it', () => {
    expect(parseChord('Super+KeyS')).toBeNull()
  })

  it('round-trips every default binding', () => {
    for (const id of ACTION_IDS) {
      for (const chord of DEFAULT_BINDINGS[id]) expect(parseChord(chord)).toBe(chord)
    }
  })
})

describe('formatChord', () => {
  it('shows arrows and punctuation as themselves', () => {
    expect(formatChord('Alt+ArrowLeft')).toBe('Alt + ←')
    expect(formatChord('Ctrl+Comma')).toBe('Ctrl + ,')
    expect(formatChord('Ctrl+Equal')).toBe('Ctrl + =')
  })

  it('drops the Key prefix', () => {
    expect(formatChord('Alt+Shift+KeyW')).toBe('Alt + Shift + W')
  })

  it('shows the session row as the range it is', () => {
    expect(formatChord(`Alt+${DIGIT_CODE}`)).toBe('Alt + 1~9')
  })

  it('names the numpad keys', () => {
    expect(formatChord('Ctrl+NumpadAdd')).toBe('Ctrl + Numpad +')
    expect(formatChord('Ctrl+Numpad0')).toBe('Ctrl + Numpad 0')
  })
})

describe('chordRisk', () => {
  it('flags Ctrl+letter, which is a control character', () => {
    expect(chordRisk('Ctrl+KeyC')).toBe('control-char')
    expect(chordRisk('Ctrl+KeyD')).toBe('control-char')
  })

  it('flags the shell word motions', () => {
    expect(chordRisk('Alt+KeyB')).toBe('shell-word')
    expect(chordRisk('Alt+KeyF')).toBe('shell-word')
  })

  it('flags an unmodified key, which is just typing', () => {
    expect(chordRisk('KeyA')).toBe('plain-key')
    expect(chordRisk('Enter')).toBe('plain-key')
  })

  it('leaves the function keys alone — nothing types them', () => {
    expect(chordRisk('F11')).toBeNull()
  })

  it('clears every default binding', () => {
    for (const id of ACTION_IDS) {
      for (const chord of DEFAULT_BINDINGS[id]) expect(chordRisk(chord)).toBeNull()
    }
  })

  it('leaves Option alone on mac, where the terminal owns it', () => {
    expect(chordRisk('Alt+KeyB', true)).toBeNull()
    expect(chordRisk('Alt+KeyF', true)).toBeNull()
  })

  it('still flags a control character on mac', () => {
    expect(chordRisk('Ctrl+KeyC', true)).toBe('control-char')
    expect(chordRisk('KeyA', true)).toBe('plain-key')
  })

  it('flags the four Cmd keys the system takes first', () => {
    for (const code of ['KeyQ', 'KeyW', 'KeyH', 'KeyM']) {
      expect(chordRisk(`Meta+${code}`, true)).toBe('system-key')
    }
    // Only bare Cmd: the mac defaults put real actions behind Shift+Cmd+W/M.
    expect(chordRisk('Shift+Meta+KeyW', true)).toBeNull()
    expect(chordRisk('Shift+Meta+KeyM', true)).toBeNull()
  })

  it('flags Cmd+C/V for anything but copy and paste, which the menu delivers', () => {
    expect(chordRisk('Meta+KeyC', true, 'split-down')).toBe('menu-owned')
    expect(chordRisk('Meta+KeyV', true, 'split-down')).toBe('menu-owned')
    expect(chordRisk('Meta+KeyC', true, 'copy')).toBeNull()
    expect(chordRisk('Meta+KeyV', true, 'paste')).toBeNull()
  })

  it('says nothing about Cmd off mac, where the chord cannot fire at all', () => {
    for (const code of ['KeyQ', 'KeyW', 'KeyH', 'KeyM', 'KeyC', 'KeyV']) {
      expect(chordRisk(`Meta+${code}`)).toBeNull()
    }
  })

  it('clears every mac default binding', () => {
    for (const id of ACTION_IDS) {
      for (const chord of DEFAULT_BINDINGS_MAC[id]) expect(chordRisk(chord, true, id)).toBeNull()
    }
  })
})

describe('findConflicts', () => {
  it('finds nothing in the defaults', () => {
    expect(findConflicts(DEFAULT_BINDINGS).size).toBe(0)
  })

  it('names every action claiming the chord', () => {
    const clash = withChords(DEFAULT_BINDINGS, 'overview', ['Alt+KeyS'])
    expect(findConflicts(clash).get('Alt+KeyS')).toEqual(['overview', 'toggle-sidebar'])
  })
})

describe('normalizeBindings', () => {
  it('fills in every action from the defaults', () => {
    expect(normalizeBindings({})).toEqual(DEFAULT_BINDINGS)
    expect(normalizeBindings(null)).toEqual(DEFAULT_BINDINGS)
    expect(normalizeBindings('nonsense')).toEqual(DEFAULT_BINDINGS)
  })

  it('takes a lone string, which is what a hand-written file holds', () => {
    expect(normalizeBindings({ overview: 'Alt+Space' })['overview']).toEqual(['Alt+Space'])
  })

  it('drops an unusable chord and keeps the rest of the row', () => {
    expect(normalizeBindings({ overview: ['Alt+Banana', 'Alt+Space'] })['overview']).toEqual([
      'Alt+Space',
    ])
  })

  it('ignores an action it does not know', () => {
    expect(normalizeBindings({ 'launch-rockets': 'Alt+KeyR' })).toEqual(DEFAULT_BINDINGS)
  })

  it('keeps an empty row empty — no key at all is a real choice', () => {
    expect(normalizeBindings({ overview: [] })['overview']).toEqual([])
  })

  it('drops duplicates and stops at the cap', () => {
    const many = ['Alt+KeyA', 'alt+KeyA', 'Alt+KeyB', 'Alt+KeyC', 'Alt+KeyD', 'Alt+KeyE']
    expect(normalizeBindings({ overview: many })['overview']).toHaveLength(MAX_CHORDS)
  })
})

describe('changedBindings', () => {
  it('writes nothing when everything is default', () => {
    expect(changedBindings(DEFAULT_BINDINGS)).toEqual({})
  })

  it('writes only the rows that differ, and reads back the same', () => {
    const changed = withChords(DEFAULT_BINDINGS, 'overview', ['Alt+Space'])
    expect(changedBindings(changed)).toEqual({ overview: ['Alt+Space'] })
    expect(normalizeBindings(changedBindings(changed))).toEqual(changed)
  })

  it('records a row the user emptied', () => {
    expect(changedBindings(withChords(DEFAULT_BINDINGS, 'overview', []))).toEqual({ overview: [] })
  })
})

describe('the action list', () => {
  it('covers every action exactly once', () => {
    expect(new Set(ACTION_IDS).size).toBe(ACTION_IDS.length)
    expect([...ACTION_IDS].sort()).toEqual(Object.keys(DEFAULT_BINDINGS).sort())
  })

  it('puts every grouped action in the list', () => {
    const ids = new Set<string>(ACTION_IDS)
    for (const group of ACTION_GROUPS) for (const id of group.ids) expect(ids.has(id)).toBe(true)
  })

  it('starts out entirely default', () => {
    for (const id of ACTION_IDS) expect(isDefault(DEFAULT_BINDINGS, id)).toBe(true)
    expect(isDefault(withChords(DEFAULT_BINDINGS, 'overview', ['Alt+Space']), 'overview')).toBe(
      false,
    )
  })
})

describe('meta chords', () => {
  it('maps metaKey to Meta+ on mac', () => {
    expect(
      chordFromEvent({ code: 'KeyU', altKey: false, ctrlKey: false, shiftKey: false, metaKey: true }, true),
    ).toBe('Meta+KeyU')
  })

  it('keeps canonical order Ctrl+Alt+Shift+Meta', () => {
    expect(
      chordFromEvent({ code: 'KeyF', altKey: false, ctrlKey: true, shiftKey: true, metaKey: true }, true),
    ).toBe('Ctrl+Shift+Meta+KeyF')
  })

  it('still rejects metaKey off mac', () => {
    expect(
      chordFromEvent({ code: 'KeyU', altKey: false, ctrlKey: false, shiftKey: false, metaKey: true }),
    ).toBeNull()
  })

  it('parses cmd/meta/command names', () => {
    expect(parseChord('Cmd+Shift+KeyW')).toBe('Shift+Meta+KeyW')
    expect(parseChord('meta+Comma')).toBe('Meta+Comma')
    expect(parseChord('Command+KeyF')).toBe('Meta+KeyF')
  })

  it('formats mac-style symbols on mac', () => {
    expect(formatChord('Shift+Meta+KeyW', true)).toBe('⇧⌘W')
    expect(formatChord('Meta+ArrowLeft', true)).toBe('⌘←')
    expect(formatChord('Ctrl+Alt+Shift+Meta+KeyA', true)).toBe('⌃⌥⇧⌘A')
  })

  it('labels Meta as Cmd off mac', () => {
    expect(formatChord('Meta+KeyF')).toBe('Cmd + F')
  })
})

describe('mac defaults', () => {
  it('has no plain Cmd+Q/W/H/M — reserved by the system', () => {
    for (const chords of Object.values(DEFAULT_BINDINGS_MAC)) {
      for (const chord of chords) {
        expect(['Meta+KeyQ', 'Meta+KeyW', 'Meta+KeyH', 'Meta+KeyM']).not.toContain(chord)
      }
    }
  })

  it('has no bare-Alt chords — Option types characters on a Mac', () => {
    for (const chords of Object.values(DEFAULT_BINDINGS_MAC)) {
      for (const chord of chords) expect(chord.split('+')).not.toContain('Alt')
    }
  })

  it('is conflict-free', () => {
    expect(findConflicts(DEFAULT_BINDINGS_MAC).size).toBe(0)
  })

  it('covers every action', () => {
    for (const id of ACTION_IDS) expect(DEFAULT_BINDINGS_MAC[id].length).toBeGreaterThan(0)
  })

  it('matches the default table chord for chord', () => {
    // The self-check translates a Linux chord to its mac twin by position, so an
    // unbalanced row would silently translate to the wrong key.
    for (const id of ACTION_IDS) {
      expect(DEFAULT_BINDINGS_MAC[id].length, id).toBe(DEFAULT_BINDINGS[id].length)
    }
  })

  it('follows mac conventions for the household names', () => {
    expect(DEFAULT_BINDINGS_MAC.copy).toEqual(['Meta+KeyC'])
    expect(DEFAULT_BINDINGS_MAC.paste).toEqual(['Meta+KeyV'])
    expect(DEFAULT_BINDINGS_MAC.search).toEqual(['Meta+KeyF'])
    expect(DEFAULT_BINDINGS_MAC.settings).toEqual(['Meta+Comma'])
    expect(DEFAULT_BINDINGS_MAC['save-layout']).toEqual(['Meta+KeyS'])
  })

  it('every chord is canonical', () => {
    for (const chords of Object.values(DEFAULT_BINDINGS_MAC)) {
      for (const chord of chords) expect(parseChord(chord)).toBe(chord)
    }
  })

  it('defaultBindingsFor picks the table by platform', () => {
    expect(defaultBindingsFor(true)).toBe(DEFAULT_BINDINGS_MAC)
    expect(defaultBindingsFor(false)).toBe(DEFAULT_BINDINGS)
  })

  it('threads the platform through the default-consuming helpers', () => {
    expect(normalizeBindings({}, true)).toEqual(DEFAULT_BINDINGS_MAC)
    expect(normalizeBindings({})).toEqual(DEFAULT_BINDINGS)
    for (const id of ACTION_IDS) expect(isDefault(DEFAULT_BINDINGS_MAC, id, true)).toBe(true)
    expect(changedBindings(DEFAULT_BINDINGS_MAC, true)).toEqual({})
    expect(changedBindings(DEFAULT_BINDINGS)).toEqual({})
  })
})
