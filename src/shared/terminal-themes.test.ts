import { describe, expect, it } from 'vitest'
import { BUILT_IN_THEMES, DEFAULT_THEME, themeById, type TerminalTheme } from './terminal-themes'

const COLOR_KEYS: (keyof TerminalTheme)[] = [
  'background', 'foreground', 'cursor', 'selection',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
]

/** WCAG relative luminance, enough to tell a dark ground from a light one. */
function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

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
    // Selection alone may carry alpha, as several upstreams publish it that way.
    for (const theme of BUILT_IN_THEMES) {
      for (const key of COLOR_KEYS) {
        const pattern =
          key === 'selection'
            ? /^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|rgba?\([\d\s.,]+\))$/
            : /^#[0-9a-fA-F]{6}$/
        expect(String(theme[key]), `${theme.id}.${String(key)}`).toMatch(pattern)
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

  it('bundles nineteen palettes', () => {
    // The settings list is a fixed set; a dropped entry is a silent regression
    // for anyone whose settings.yaml names it.
    expect(BUILT_IN_THEMES).toHaveLength(19)
  })

  it('every palette is dark', () => {
    // The bundled set is deliberately dark-only: a light palette here would
    // only ever be picked by mistake.
    for (const theme of BUILT_IN_THEMES) {
      expect(relativeLuminance(theme.background), theme.id).toBeLessThan(0.2)
    }
  })

  it('includes kanagawa wave', () => {
    const kanagawa = BUILT_IN_THEMES.find((t) => t.id === 'kanagawa-wave')
    expect(kanagawa?.background).toBe('#1f1f28')
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

  it('falls back for a palette that used to be bundled', () => {
    // A settings.yaml written before the palette set was trimmed still names
    // one of these; startup must survive it.
    for (const gone of ['vimbones', 'kanagawabones', 'zenburned', 'seoulbones']) {
      expect(themeById(gone), gone).toBe(DEFAULT_THEME)
    }
  })

  it('user palettes share the namespace with bundled ones', () => {
    const mine = { ...DEFAULT_THEME, id: 'mine', label: '내 것' }
    expect(themeById('mine', [mine]).label).toBe('내 것')
  })
})
