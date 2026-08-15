import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BINDINGS } from '../shared/keybindings'
import { DEFAULT_SETTINGS } from '../shared/settings-defaults'
import type { AppSettings } from '../shared/protocol'
import type { SettingsView } from './settings-view'

/*
 * `api` is captured when the module loads, so the stub has to be on window
 * before the import — hence the dynamic import below.
 */
const saveSettings = vi.fn<(next: AppSettings) => Promise<AppSettings>>(async (next) => next)

vi.stubGlobal('termspace', {
  saveSettings,
  saveKeybindings: async (next: unknown) => next,
  listMonoFonts: async () => [],
  listUserThemes: async () => [],
  shellIntegrationStatus: async () => null,
})

const { createSettingsView } = await import('./settings-view')

let view: SettingsView
let latest: AppSettings

function open(settings: Partial<AppSettings>): void {
  latest = { ...DEFAULT_SETTINGS, ...settings }
  view.open(latest, DEFAULT_BINDINGS)
}

const reset = (key: keyof AppSettings): HTMLButtonElement =>
  document.body.querySelector<HTMLButtonElement>(`button[data-reset="${key}"]`)!

beforeEach(() => {
  document.body.innerHTML = ''
  saveSettings.mockClear()
  view = createSettingsView(document.body, {
    onChange: (next) => {
      latest = next
    },
    onBindingsChange: () => {},
    onDismiss: () => {},
  })
})

describe('restoring one setting', () => {
  it('offers a button on every row', () => {
    open({})
    for (const key of [
      'fontSize', 'uiScale', 'copyOnSelect', 'fontFamily', 'theme', 'locale', 'focusBorder',
    ] as const) {
      expect(reset(key), key).not.toBeNull()
    }
  })

  it('leaves the button inert while the row is still stock', () => {
    open({})
    expect(reset('fontSize').disabled).toBe(true)
    expect(reset('copyOnSelect').disabled).toBe(true)
  })

  it('enables only the rows that were changed', () => {
    open({ fontSize: 20, locale: 'ko' })
    expect(reset('fontSize').disabled).toBe(false)
    expect(reset('locale').disabled).toBe(false)
    expect(reset('uiScale').disabled).toBe(true)
  })

  it('puts the value back and leaves its neighbours alone', () => {
    open({ fontSize: 20, uiScale: 130 })
    reset('fontSize').click()
    expect(latest.fontSize).toBe(DEFAULT_SETTINGS.fontSize)
    expect(latest.uiScale).toBe(130)
    expect(saveSettings).toHaveBeenCalledTimes(1)
  })

  it('restores a toggle and a select too', () => {
    open({ copyOnSelect: 0, theme: 'nord' })
    reset('copyOnSelect').click()
    expect(latest.copyOnSelect).toBe(DEFAULT_SETTINGS.copyOnSelect)
    reset('theme').click()
    expect(latest.theme).toBe(DEFAULT_SETTINGS.theme)
  })
})

describe('the focused pane border', () => {
  const select = (): HTMLSelectElement =>
    document.body.querySelector<HTMLSelectElement>('select[data-setting="focusBorder"]')!
  const hex = (): HTMLInputElement =>
    document.body.querySelector<HTMLInputElement>('input[data-setting="focusBorderColor"]')!

  it('offers the three modes', () => {
    open({})
    expect([...select().options].map((o) => o.value)).toEqual(['white', 'palette', 'custom'])
    expect(select().value).toBe('white')
  })

  it('commits the mode as soon as it is picked', () => {
    open({})
    select().value = 'palette'
    select().dispatchEvent(new Event('change', { bubbles: true }))
    expect(latest.focusBorder).toBe('palette')
    expect(saveSettings).toHaveBeenCalledTimes(1)
  })

  it('leaves the colour field inert outside custom mode', () => {
    open({ focusBorder: 'palette' })
    expect(hex().disabled).toBe(true)
    open({ focusBorder: 'custom' })
    expect(hex().disabled).toBe(false)
  })

  it('takes a typed colour with or without the hash', () => {
    open({ focusBorder: 'custom' })
    hex().value = 'FF0000'
    hex().dispatchEvent(new Event('input', { bubbles: true }))
    expect(latest.focusBorderColor).toBe('#ff0000')
  })

  it('commits nothing while the colour is still half typed', () => {
    open({ focusBorder: 'custom', focusBorderColor: '#7a9bbf' })
    hex().value = '#ff00'
    hex().dispatchEvent(new Event('input', { bubbles: true }))
    expect(latest.focusBorderColor).toBe('#7a9bbf')
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('puts the last good colour back when the field is left invalid', () => {
    open({ focusBorder: 'custom', focusBorderColor: '#7a9bbf' })
    const field = hex()
    field.value = 'nope'
    field.dispatchEvent(new Event('change', { bubbles: true }))
    expect(field.value).toBe('#7a9bbf')
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('restores both keys from the one button', () => {
    open({ focusBorder: 'custom', focusBorderColor: '#ff0000' })
    expect(reset('focusBorder').disabled).toBe(false)
    reset('focusBorder').click()
    expect(latest.focusBorder).toBe(DEFAULT_SETTINGS.focusBorder)
    expect(latest.focusBorderColor).toBe(DEFAULT_SETTINGS.focusBorderColor)
  })
})
