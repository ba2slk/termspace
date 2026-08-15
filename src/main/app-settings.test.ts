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

  it('accepts only locales we ship a catalogue for', () => {
    expect(normalizeSettings({ locale: 'ko' }).locale).toBe('ko')
    expect(normalizeSettings({ locale: 'en' }).locale).toBe('en')
    // Not 'ja' — an unknown code would leave the app with no strings at all.
    expect(normalizeSettings({ locale: 'ja' }).locale).toBe('')
    expect(normalizeSettings({ locale: 'en-GB' }).locale).toBe('')
    expect(normalizeSettings({}).locale).toBe('')
  })

  it('reads a file with none of the new keys as the defaults for them', () => {
    const old = normalizeSettings({ fontSize: 15, theme: 'nord' })
    expect(old.fontSize).toBe(15)
    expect(old.uiScale).toBe(DEFAULT_SETTINGS.uiScale)
    expect(old.locale).toBe(DEFAULT_SETTINGS.locale)
    expect(old.paneLabels).toBe(DEFAULT_SETTINGS.paneLabels)
  })

  it('reads the on/off settings as 0 or 1, whatever the file says', () => {
    expect(normalizeSettings({ paneLabels: 0 }).paneLabels).toBe(0)
    expect(normalizeSettings({ paneLabels: 7 }).paneLabels).toBe(1)
    expect(normalizeSettings({ paneLabels: 0.4 }).paneLabels).toBe(0)
    expect(normalizeSettings({ paneLabels: 'off' }).paneLabels).toBe(DEFAULT_SETTINGS.paneLabels)
  })
})
