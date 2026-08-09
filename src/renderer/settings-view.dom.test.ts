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
    for (const key of ['fontSize', 'uiScale', 'copyOnSelect', 'fontFamily', 'theme', 'locale'] as const) {
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
