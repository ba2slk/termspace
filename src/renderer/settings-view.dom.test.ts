import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BINDINGS } from '../shared/keybindings'
import { DEFAULT_SETTINGS } from '../shared/settings-defaults'
import { DEFAULT_THEME, themeById } from '../shared/terminal-themes'
import type { AppSettings, TerminalTheme } from '../shared/protocol'
import type { SettingsView } from './settings-view'

/*
 * `api` is captured when the module loads, so the stub has to be on window
 * before the import — hence the dynamic import below.
 */

/**
 * The write the owner does on the view's behalf. The view never persists
 * anything itself, so this stands in for main's saveSettings.
 */
const saveSettings = vi.fn<(next: AppSettings) => Promise<AppSettings>>(async (next) => next)

/** What the themes folder holds right now; a test may add to it mid-run. */
let onDisk: readonly TerminalTheme[] = []

vi.stubGlobal('termspace', {
  listMonoFonts: async () => [],
  listUserThemes: async () => onDisk,
  shellIntegrationStatus: async () => null,
})

const { createSettingsView } = await import('./settings-view')

let view: SettingsView
let latest: AppSettings

function open(settings: Partial<AppSettings>): void {
  latest = { ...DEFAULT_SETTINGS, ...settings }
  view.open()
}

const reset = (key: keyof AppSettings): HTMLButtonElement =>
  document.body.querySelector<HTMLButtonElement>(`button[data-reset="${key}"]`)!

/** Stands in for main: it owns the palettes and reads them back the same way. */
let owned: readonly TerminalTheme[] = []

beforeEach(() => {
  document.body.innerHTML = ''
  saveSettings.mockClear()
  onDisk = []
  owned = []
  latest = DEFAULT_SETTINGS
  view = createSettingsView(document.body, {
    settings: () => latest,
    bindings: () => DEFAULT_BINDINGS,
    onPreview: (next) => {
      latest = next
    },
    // What main does: apply at once, write, then apply what came back.
    onChange: async (next) => {
      latest = next
      latest = await saveSettings(next)
    },
    onBindingsChange: async () => {},
    onDismiss: () => {},
    userThemes: () => owned,
    // Main's job: one fetch, into the one list both sides read.
    refreshUserThemes: async () => {
      owned = await Promise.resolve(onDisk)
      return owned
    },
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

describe('user palettes', () => {
  /** A palette that is not bundled, so only the folder can supply it. */
  const mine: TerminalTheme = {
    ...DEFAULT_THEME,
    id: 'mine',
    label: 'Mine',
    credit: 'me',
    background: '#0b0b0b',
  }

  const themeSelect = (): HTMLSelectElement =>
    document.body.querySelector<HTMLSelectElement>('select[data-setting="theme"]')!

  it('offers a palette dropped into the folder while the app was running', async () => {
    onDisk = [mine]
    open({})
    await vi.waitFor(() => {
      expect([...themeSelect().options].map((o) => o.value)).toContain('mine')
    })
  })

  /*
   * The bug this pins: the screen used to fetch the folder into a copy of its
   * own, so a palette picked here resolved to nothing for the panes and they
   * fell back to the default.
   */
  it('leaves the picked palette resolvable by the panes', async () => {
    onDisk = [mine]
    open({})
    await vi.waitFor(() => {
      expect([...themeSelect().options].map((o) => o.value)).toContain('mine')
    })
    themeSelect().value = 'mine'
    themeSelect().dispatchEvent(new Event('change', { bubbles: true }))
    expect(latest.theme).toBe('mine')
    expect(themeById(latest.theme, owned).background).toBe('#0b0b0b')
  })
})
