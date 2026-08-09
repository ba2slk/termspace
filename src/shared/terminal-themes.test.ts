import { describe, expect, it } from 'vitest'
import { BUILT_IN_THEMES, DEFAULT_THEME, themeById, type TerminalTheme } from './terminal-themes'

const COLOR_KEYS: (keyof TerminalTheme)[] = [
  'background', 'foreground', 'cursor', 'selection',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
]

describe('BUILT_IN_THEMES', () => {
  it('every palette defines all twenty colours', () => {
    // A missing entry falls back to xterm's default and stops being that theme.
    for (const theme of BUILT_IN_THEMES) {
      for (const key of COLOR_KEYS) {
        expect(theme[key], `${theme.id}.${String(key)}`).toBeTruthy()
      }
    }
  })

  it('colour values are #rrggbb or rgba()', () => {
    // Malformed values are silently ignored by CSS, which is hard to trace.
    for (const theme of BUILT_IN_THEMES) {
      for (const key of COLOR_KEYS) {
        expect(String(theme[key]), `${theme.id}.${String(key)}`).toMatch(
          /^(#[0-9a-fA-F]{6}|rgba?\([\d\s.,]+\))$/,
        )
      }
    }
  })

  it('ids are unique', () => {
    const ids = BUILT_IN_THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every palette records its source', () => {
    // Colour values are close to facts, but authorship still needs crediting.
    for (const theme of BUILT_IN_THEMES) {
      expect(theme.credit.length, theme.id).toBeGreaterThan(3)
    }
  })

  it('background and foreground differ', () => {
    // Identical means invisible text — an easy off-by-one when transcribing.
    for (const theme of BUILT_IN_THEMES) {
      expect(theme.background, theme.id).not.toBe(theme.foreground)
    }
  })

  it('includes kanagawabones', () => {
    const kanagawa = BUILT_IN_THEMES.find((t) => t.id === 'kanagawabones')
    expect(kanagawa?.background).toBe('#1F1F28')
    expect(kanagawa?.credit).toContain('MIT')
  })
})

describe('themeById', () => {
  it('finds by id', () => {
    expect(themeById('dracula').label).toBe('Dracula')
  })

  it('falls back to the default for an unknown name', () => {
    expect(themeById('없는테마')).toBe(DEFAULT_THEME)
    expect(themeById('')).toBe(DEFAULT_THEME)
  })

  it('user palettes share the namespace with bundled ones', () => {
    const mine = { ...DEFAULT_THEME, id: 'mine', label: '내 것' }
    expect(themeById('mine', [mine]).label).toBe('내 것')
  })
})
