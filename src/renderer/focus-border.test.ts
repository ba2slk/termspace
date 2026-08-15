import { describe, expect, it } from 'vitest'
import { normalizeHex, resolveFocusBorder } from './focus-border'
import { DEFAULT_SETTINGS } from '../shared/settings-defaults'
import { DEFAULT_THEME, themeById } from '../shared/terminal-themes'
import type { AppSettings } from '../shared/protocol'

const settings = (extra: Partial<AppSettings>): AppSettings => ({ ...DEFAULT_SETTINGS, ...extra })

describe('normalizeHex', () => {
  it('takes a colour with or without the hash', () => {
    expect(normalizeHex('#A1B2C3')).toBe('#a1b2c3')
    expect(normalizeHex('a1b2c3')).toBe('#a1b2c3')
    expect(normalizeHex('  #FF0000 ')).toBe('#ff0000')
  })

  it('refuses anything else', () => {
    // The value reaches a CSS declaration, so a half-typed one must not.
    expect(normalizeHex('#abc')).toBeNull()
    expect(normalizeHex('red')).toBeNull()
    expect(normalizeHex('#12345g')).toBeNull()
    expect(normalizeHex('')).toBeNull()
  })
})

describe('resolveFocusBorder', () => {
  it('leaves the tokens alone in white mode', () => {
    expect(resolveFocusBorder(settings({ focusBorder: 'white' }), DEFAULT_THEME)).toBeNull()
    // An unknown mode from a hand-edited file reads as white, never as nothing.
    expect(resolveFocusBorder(settings({ focusBorder: 'neon' }), DEFAULT_THEME)).toBeNull()
  })

  it("follows the palette's accent", () => {
    const nord = themeById('nord')
    const resolved = resolveFocusBorder(settings({ focusBorder: 'palette' }), nord)
    expect(resolved?.border).toBe(nord.accent)
    expect(resolved?.ring).toContain(nord.accent)
  })

  it('falls back to the blue for a palette with no accent', () => {
    const old = { ...DEFAULT_THEME, accent: '' }
    expect(resolveFocusBorder(settings({ focusBorder: 'palette' }), old)?.border).toBe(old.blue)
  })

  it('uses the chosen colour in custom mode', () => {
    const resolved = resolveFocusBorder(
      settings({ focusBorder: 'custom', focusBorderColor: '#FF0000' }),
      DEFAULT_THEME,
    )
    expect(resolved?.border).toBe('#ff0000')
  })

  it('drops back to the tokens rather than emit an invalid colour', () => {
    expect(
      resolveFocusBorder(settings({ focusBorder: 'custom', focusBorderColor: 'nope' }), DEFAULT_THEME),
    ).toBeNull()
  })

  it('thins the ring out of the same colour', () => {
    // Solid border, translucent ring — the relation the tokens already have.
    const resolved = resolveFocusBorder(
      settings({ focusBorder: 'custom', focusBorderColor: '#7a9bbf' }),
      DEFAULT_THEME,
    )
    expect(resolved?.ring).toBe('color-mix(in srgb, #7a9bbf 45%, transparent)')
  })
})
