import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from './app-settings'

describe('normalizeSettings', () => {
  it('keeps uiScale inside its bounds', () => {
    expect(normalizeSettings({ uiScale: 300 }).uiScale).toBe(160)
    expect(normalizeSettings({ uiScale: 10 }).uiScale).toBe(80)
    expect(normalizeSettings({ uiScale: 125 }).uiScale).toBe(125)
  })

  it('falls back to the default scale for anything that is not a number', () => {
    expect(normalizeSettings({ uiScale: '120' }).uiScale).toBe(DEFAULT_SETTINGS.uiScale)
    expect(normalizeSettings({ uiScale: Number.NaN }).uiScale).toBe(DEFAULT_SETTINGS.uiScale)
  })

  it('knows two text rendering modes and falls back to greyscale', () => {
    expect(normalizeSettings({ textRendering: 'subpixel' }).textRendering).toBe('subpixel')
    expect(normalizeSettings({ textRendering: 'grayscale' }).textRendering).toBe('grayscale')
    expect(normalizeSettings({ textRendering: 'lcd' }).textRendering).toBe('grayscale')
    expect(normalizeSettings({}).textRendering).toBe('grayscale')
  })

  it('accepts only locales we ship a catalogue for', () => {
    expect(normalizeSettings({ locale: 'ko' }).locale).toBe('ko')
    expect(normalizeSettings({ locale: 'en' }).locale).toBe('en')
    // Not 'ja' — an unknown code would leave the app with no strings at all.
    expect(normalizeSettings({ locale: 'ja' }).locale).toBe('')
    expect(normalizeSettings({ locale: 'en-GB' }).locale).toBe('')
    expect(normalizeSettings({}).locale).toBe('')
  })

  it('accepts only the three focus border modes', () => {
    expect(normalizeSettings({ focusBorder: 'palette' }).focusBorder).toBe('palette')
    expect(normalizeSettings({ focusBorder: 'custom' }).focusBorder).toBe('custom')
    expect(normalizeSettings({ focusBorder: 'neon' }).focusBorder).toBe(DEFAULT_SETTINGS.focusBorder)
    expect(normalizeSettings({ focusBorder: 3 }).focusBorder).toBe(DEFAULT_SETTINGS.focusBorder)
  })

  it('takes the focus border colour only as a six-digit hex', () => {
    // It reaches a CSS declaration, so anything else falls back rather than
    // being passed through.
    expect(normalizeSettings({ focusBorderColor: '#FF0000' }).focusBorderColor).toBe('#ff0000')
    expect(normalizeSettings({ focusBorderColor: ' #a1b2c3 ' }).focusBorderColor).toBe('#a1b2c3')
    const stock = DEFAULT_SETTINGS.focusBorderColor
    expect(normalizeSettings({ focusBorderColor: 'red' }).focusBorderColor).toBe(stock)
    expect(normalizeSettings({ focusBorderColor: '#abc' }).focusBorderColor).toBe(stock)
    expect(normalizeSettings({ focusBorderColor: 'ff0000' }).focusBorderColor).toBe(stock)
  })

  it('reads a file with none of the new keys as the defaults for them', () => {
    const old = normalizeSettings({ fontSize: 15, theme: 'nord' })
    expect(old.fontSize).toBe(15)
    expect(old.uiScale).toBe(DEFAULT_SETTINGS.uiScale)
    expect(old.locale).toBe(DEFAULT_SETTINGS.locale)
    expect(old.paneLabels).toBe(DEFAULT_SETTINGS.paneLabels)
    expect(old.focusBorder).toBe(DEFAULT_SETTINGS.focusBorder)
  })

  it('reads the on/off settings as 0 or 1, whatever the file says', () => {
    expect(normalizeSettings({ paneLabels: 0 }).paneLabels).toBe(0)
    expect(normalizeSettings({ paneLabels: 7 }).paneLabels).toBe(1)
    expect(normalizeSettings({ paneLabels: 0.4 }).paneLabels).toBe(0)
    expect(normalizeSettings({ paneLabels: 'off' }).paneLabels).toBe(DEFAULT_SETTINGS.paneLabels)
  })

  it('reads updateCheck as 0 or 1 and defaults it on', () => {
    expect(normalizeSettings({}).updateCheck).toBe(1)
    expect(normalizeSettings({ updateCheck: 0 }).updateCheck).toBe(0)
    expect(normalizeSettings({ updateCheck: 5 }).updateCheck).toBe(1)
    expect(normalizeSettings({ updateCheck: 'no' }).updateCheck).toBe(1)
  })
})
