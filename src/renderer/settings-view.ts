/**
 * The settings screen (Ctrl+,).
 *
 * Its first job is showing what can be changed at all. Edits apply immediately
 * and persist to ~/.config/termspace/settings.yaml, which stays editable by
 * hand for anyone keeping it in dotfiles.
 */
import type { AppSettings, Bindings, ShellIntegrationStatus, TerminalTheme } from '../shared/protocol'
import { defaultBindingsFor } from '../shared/keybindings'
import { DEFAULT_SETTINGS, isDefaultSetting } from '../shared/settings-defaults'
import { BUILT_IN_THEMES } from '../shared/terminal-themes'
import { api } from './api'
import { normalizeHex } from './focus-border'
import { IS_MAC } from './platform'
import { createKeybindingsPanel, type KeybindingsPanel } from './keybindings-view'
import { t } from './i18n'

interface Limit {
  readonly min: number
  readonly max: number
  readonly step: number
}

/** Sliders and toggles handle numbers only; text settings get their own control. */
type NumericKey = {
  [K in keyof AppSettings]: AppSettings[K] extends number ? K : never
}[keyof AppSettings]

interface FieldSpec {
  readonly key: NumericKey
  readonly label: string
  readonly description: string
  readonly limit: Limit
  readonly unit?: string
  readonly decimals?: number
}

const FIELDS: readonly FieldSpec[] = [
  {
    key: 'defaultColumnWidth',
    label: t.settings.defaultColumnWidthLabel,
    description: t.settings.defaultColumnWidthDesc,
    limit: { min: 240, max: 3000, step: 20 },
    unit: t.settings.unitPx,
  },
  {
    key: 'fontSize',
    label: t.settings.fontSizeLabel,
    description: t.settings.fontSizeDesc,
    limit: { min: 9, max: 24, step: 1 },
    unit: t.settings.unitPx,
  },
  {
    key: 'lineHeight',
    label: t.settings.lineHeightLabel,
    description: t.settings.lineHeightDesc,
    limit: { min: 1, max: 2, step: 0.05 },
    decimals: 2,
  },
  {
    key: 'scrollback',
    label: t.settings.scrollbackLabel,
    description: t.settings.scrollbackDesc,
    limit: { min: 200, max: 100_000, step: 500 },
    unit: t.settings.unitLines,
  },
  {
    key: 'idleDim',
    label: t.settings.idleDimLabel,
    description: t.settings.idleDimDesc,
    limit: { min: 0, max: 60, step: 5 },
    unit: t.settings.unitPercent,
  },
  {
    key: 'scrollBoost',
    label: t.settings.scrollBoostLabel,
    description: t.settings.scrollBoostDesc,
    limit: { min: 1, max: 12, step: 0.5 },
    unit: t.settings.unitTimes,
    decimals: 1,
  },
]

/** Binary settings — a slider between 0 and 1 reads worse than two buttons. */
interface ToggleSpec {
  readonly key: NumericKey
  readonly label: string
  readonly description: string
}

/** Sits with the terminal's own settings: it is about what programs do, not the mouse. */
const NOTIFICATIONS: ToggleSpec = {
  key: 'notifications',
  label: t.settings.notificationsLabel,
  description: t.settings.notificationsDesc,
}

/** The app's own size, kept away from the terminal's fields on purpose. */
const APPEARANCE: FieldSpec = {
  key: 'uiScale',
  label: t.settings.uiScaleLabel,
  description: t.settings.uiScaleDesc,
  limit: { min: 80, max: 160, step: 5 },
  unit: t.settings.unitPercent,
}

const TOGGLES: readonly ToggleSpec[] = [
  {
    key: 'copyOnSelect',
    label: t.settings.copyOnSelectLabel,
    description: t.settings.copyOnSelectDesc,
  },
  {
    key: 'barPanning',
    label: t.settings.barPanningLabel,
    description: t.settings.barPanningDesc,
  },
  {
    key: 'shiftPanning',
    label: t.settings.shiftPanningLabel,
    description: t.settings.shiftPanningDesc,
  },
]

/** Held-key behaviour: its own section, since it is not about the mouse. */
const KEYBOARD: readonly ToggleSpec[] = [
  {
    key: 'paneLabels',
    label: t.settings.paneLabelsLabel,
    description: t.settings.paneLabelsDesc,
  },
]

export interface SettingsHooks {
  /** Apply to live sessions immediately. */
  readonly onChange: (settings: AppSettings) => void
  /** Likewise: a rebound key takes effect before it is written to disk. */
  readonly onBindingsChange: (bindings: Bindings) => void
  readonly onDismiss: () => void
}

export interface SettingsView {
  open(settings: AppSettings, bindings: Bindings): void
  close(): void
  readonly visible: boolean
  destroy(): void
}

function format(value: number, field: FieldSpec): string {
  const text = field.decimals === undefined ? String(value) : value.toFixed(field.decimals)
  return field.unit === undefined ? text : `${text}${field.unit}`
}

export function createSettingsView(host: HTMLElement, hooks: SettingsHooks): SettingsView {
  // The sheet floats with a gap all round; without a backdrop the live canvas
  // shows through it.
  const layer = document.createElement('div')
  layer.className = 'sheet-layer'
  layer.hidden = true

  const sheet = document.createElement('div')
  sheet.className = 'sheet settings'
  layer.append(sheet)
  host.append(layer)

  let settings: AppSettings | null = null
  /** Installed monospace fonts, fetched once on first open. */
  let monoFonts: readonly string[] = []
  let shellIntegration: ShellIntegrationStatus | null = null
  /** User palettes, appended after the bundled ones. */
  let userThemes: readonly TerminalTheme[] = []

  let bindings: Bindings = defaultBindingsFor(IS_MAC)
  let tab: 'general' | 'keys' = 'general'

  /*
   * Built once and kept: it holds which row is being recorded, and rebuilding
   * it on every redraw of the sheet would drop that mid-keystroke.
   */
  const keysPanel: KeybindingsPanel = createKeybindingsPanel({
    bindings: () => bindings,
    onChange: (next) => {
      bindings = next
      hooks.onBindingsChange(next)
      // Chords may come back dropped, so keep what was actually stored.
      void api.saveKeybindings(next).then((saved) => {
        bindings = saved
        hooks.onBindingsChange(saved)
      })
    },
  })

  function commit(next: AppSettings): void {
    settings = next
    hooks.onChange(next)
    // Values may come back clamped, so redraw from what was stored.
    void api.saveSettings(next).then((saved) => {
      settings = saved
      hooks.onChange(saved)
      render()
    })
  }

  /**
   * Put one setting back to what the app ships with.
   *
   * Drawn on every row, not only changed ones: appearing and disappearing would
   * shift the control beside it the moment a slider left its default.
   */
  function resetButton(
    key: keyof AppSettings,
    ...also: readonly (keyof AppSettings)[]
  ): HTMLButtonElement {
    const keys = [key, ...also]
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'settings__reset'
    button.textContent = '↺'
    button.title = t.settings.resetRow
    button.dataset['reset'] = key
    const snapshot = settings
    const stock = snapshot === null || keys.every((k) => isDefaultSetting(snapshot, k))
    button.disabled = stock
    button.setAttribute('aria-hidden', String(stock))
    button.addEventListener('click', () => {
      if (settings === null) return
      const next = { ...settings }
      for (const k of keys) Object.assign(next, { [k]: DEFAULT_SETTINGS[k] })
      commit(next)
    })
    return button
  }

  function fieldRow(field: FieldSpec, value: number): HTMLElement {
    const row = document.createElement('div')
    row.className = 'settings__row'

    const text = document.createElement('div')
    text.className = 'settings__text'
    const label = document.createElement('span')
    label.textContent = field.label
    const description = document.createElement('small')
    description.textContent = field.description
    text.append(label, description)

    const control = document.createElement('div')
    control.className = 'settings__control'

    const slider = document.createElement('input')
    slider.type = 'range'
    slider.dataset['setting'] = field.key
    slider.min = String(field.limit.min)
    slider.max = String(field.limit.max)
    slider.step = String(field.limit.step)
    slider.value = String(value)

    const readout = document.createElement('span')
    readout.className = 'settings__value'
    readout.textContent = format(value, field)

    slider.addEventListener('input', () => {
      const next = Number(slider.value)
      readout.textContent = format(next, field)
      if (settings !== null) {
        settings = { ...settings, [field.key]: next }
        hooks.onChange(settings) // show the change live while dragging
      }
    })
    slider.addEventListener('change', () => {
      if (settings !== null) commit({ ...settings, [field.key]: Number(slider.value) })
    })

    control.append(slider, readout, resetButton(field.key))
    row.append(text, control)
    return row
  }

  function toggleRow(spec: ToggleSpec, value: number): HTMLElement {
    const row = document.createElement('div')
    row.className = 'settings__row'

    const text = document.createElement('div')
    text.className = 'settings__text'
    const label = document.createElement('span')
    label.textContent = spec.label
    const description = document.createElement('small')
    description.textContent = spec.description
    text.append(label, description)

    const control = document.createElement('div')
    control.className = 'settings__control'

    const group = document.createElement('div')
    group.className = 'settings__toggle'
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', spec.label)

    for (const [text_, on] of [
      [t.settings.off, 0],
      [t.settings.on, 1],
    ] as const) {
      const segment = document.createElement('button')
      segment.type = 'button'
      segment.className = value === on ? 'settings__segment settings__segment--on' : 'settings__segment'
      segment.textContent = text_
      segment.setAttribute('aria-pressed', String(value === on))
      segment.addEventListener('click', () => {
        if (settings !== null && settings[spec.key] !== on) commit({ ...settings, [spec.key]: on })
      })
      group.append(segment)
    }

    control.append(group, resetButton(spec.key))
    row.append(text, control)
    return row
  }

  /** One rc file, its line, and a button that copies it. */
  function shellLine(label: string, rcLine: string): readonly HTMLElement[] {
    const row = document.createElement('div')
    row.className = 'settings__row'
    const text = document.createElement('div')
    text.className = 'settings__text'
    const name = document.createElement('span')
    name.textContent = label
    text.append(name)

    const control = document.createElement('div')
    control.className = 'settings__control'
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'button'
    copy.textContent = t.settings.shellCopy
    copy.addEventListener('click', () => {
      api.writeClipboard(rcLine)
      copy.textContent = t.settings.shellCopied
    })
    control.append(copy)
    row.append(text, control)

    const line = document.createElement('pre')
    line.className = 'settings__snippet'
    line.textContent = rcLine

    return [row, line]
  }

  /**
   * The one line the user adds to their rc file. Shown rather than installed:
   * the app has no business editing someone's shell config.
   */
  function shellBody(status: ShellIntegrationStatus): HTMLElement {
    const body = document.createElement('div')

    const head = document.createElement('div')
    head.className = 'settings__row'
    const headText = document.createElement('div')
    headText.className = 'settings__text'
    const state = document.createElement('span')
    state.textContent = status.active ? t.settings.shellActive : t.settings.shellInactive
    const lead = document.createElement('small')
    lead.textContent = t.settings.shellLead
    headText.append(state, lead)
    head.append(headText)

    const note = document.createElement('small')
    note.className = 'settings__subnote'
    note.textContent = t.settings.shellNote

    body.append(
      head,
      ...shellLine(t.settings.shellBash, status.rcLine),
      ...shellLine(t.settings.shellZsh, status.rcLineZsh),
      note,
    )
    return body
  }

  function section(title: string, body: HTMLElement): HTMLElement {
    const wrap = document.createElement('section')
    wrap.className = 'settings__section'
    const heading = document.createElement('h3')
    heading.className = 'settings__heading'
    heading.textContent = title
    const card = document.createElement('div')
    card.className = 'settings__card'
    card.append(body)
    wrap.append(heading, card)
    return wrap
  }

  /**
   * Pick from a list rather than free text: a typo would silently swap the font.
   */
  function fontRow(value: string): HTMLElement {
    const row = document.createElement('div')
    row.className = 'settings__row'

    const text = document.createElement('div')
    text.className = 'settings__text'
    const label = document.createElement('span')
    label.textContent = t.settings.fontLabel
    const description = document.createElement('small')
    description.textContent =
      monoFonts.length === 0 ? t.settings.fontListFailed : t.settings.fontDesc
    text.append(label, description)

    const control = document.createElement('div')
    control.className = 'settings__control'

    const select = document.createElement('select')
    select.className = 'settings__select'
    // Named, not positioned: the self-check reaches these by name, and a new
    // row above would otherwise silently point it at the wrong control.
    select.dataset['setting'] = 'fontFamily'
    select.disabled = monoFonts.length === 0

    const auto = document.createElement('option')
    auto.value = ''
    auto.textContent = t.settings.fontDefault
    select.append(auto)

    for (const font of monoFonts) {
      const option = document.createElement('option')
      option.value = font
      option.textContent = font
      select.append(option)
    }

    // Keep a hand-written font visible even when missing, or the list would
    // silently show a choice the user never made.
    if (value !== '' && !monoFonts.includes(value)) {
      const missing = document.createElement('option')
      missing.value = value
      missing.textContent = t.settings.fontMissing(value)
      select.append(missing)
    }

    select.value = value
    select.addEventListener('change', () => {
      if (settings !== null) commit({ ...settings, fontFamily: select.value })
    })

    control.append(select, resetButton('fontFamily'))
    row.append(text, control)
    return row
  }

  /**
   * Palette picker with a swatch row — names alone don't tell you the colours.
   */
  function themeRow(value: string): HTMLElement {
    const row = document.createElement('div')
    row.className = 'settings__row'

    const text = document.createElement('div')
    text.className = 'settings__text'
    const label = document.createElement('span')
    label.textContent = t.settings.paletteLabel
    const description = document.createElement('small')
    const all = [...BUILT_IN_THEMES, ...userThemes]
    const chosen = all.find((t) => t.id === value) ?? all[0]!
    description.textContent = chosen.credit
    text.append(label, description)

    const control = document.createElement('div')
    control.className = 'settings__control settings__control--theme'

    const swatches = document.createElement('div')
    swatches.className = 'settings__swatches'
    swatches.title = chosen.label
    for (const color of [
      chosen.black, chosen.red, chosen.green, chosen.yellow,
      chosen.blue, chosen.magenta, chosen.cyan, chosen.white,
    ]) {
      const dot = document.createElement('span')
      dot.className = 'settings__swatch'
      dot.style.background = color
      swatches.append(dot)
    }
    // Show the background too; the 16 colours mean little without it.
    swatches.style.background = chosen.background
    swatches.style.borderColor = chosen.brightBlack

    const select = document.createElement('select')
    select.className = 'settings__select'
    select.dataset['setting'] = 'theme'
    for (const theme of all) {
      const option = document.createElement('option')
      option.value = theme.id
      option.textContent = theme.label
      select.append(option)
    }
    select.value = chosen.id
    select.addEventListener('change', () => {
      if (settings !== null) commit({ ...settings, theme: select.value })
    })

    control.append(swatches, select, resetButton('theme'))
    row.append(text, control)
    return row
  }

  /**
   * The focused pane's border colour: a mode, and the colour the custom mode
   * uses. One row, because the field is meaningless without the mode beside it.
   */
  function focusBorderRow(mode: string, color: string): HTMLElement {
    const row = document.createElement('div')
    row.className = 'settings__row'

    const text = document.createElement('div')
    text.className = 'settings__text'
    const label = document.createElement('span')
    label.textContent = t.settings.focusBorderLabel
    const description = document.createElement('small')
    description.textContent = t.settings.focusBorderDesc
    text.append(label, description)

    const control = document.createElement('div')
    control.className = 'settings__control'

    const select = document.createElement('select')
    select.className = 'settings__select'
    select.dataset['setting'] = 'focusBorder'
    for (const [id, name] of [
      ['white', t.settings.focusBorderWhite],
      ['palette', t.settings.focusBorderPalette],
      ['custom', t.settings.focusBorderCustom],
    ] as const) {
      const option = document.createElement('option')
      option.value = id
      option.textContent = name
      select.append(option)
    }
    select.value = mode
    select.addEventListener('change', () => {
      if (settings !== null) commit({ ...settings, focusBorder: select.value })
    })

    const hex = document.createElement('input')
    hex.type = 'text'
    hex.className = 'settings__hex'
    hex.dataset['setting'] = 'focusBorderColor'
    hex.value = color
    hex.maxLength = 7
    hex.spellcheck = false
    hex.title = t.settings.focusBorderColorTitle
    hex.setAttribute('aria-label', t.settings.focusBorderLabel)
    // The colour only means anything in custom mode; the other two would show a
    // field that changes nothing.
    hex.disabled = mode !== 'custom'
    hex.addEventListener('input', () => {
      // Half-typed is not a colour yet, so nothing is applied until it is one.
      const typed = normalizeHex(hex.value)
      if (typed === null || settings === null) return
      settings = { ...settings, focusBorderColor: typed }
      hooks.onChange(settings) // show it live, like a slider being dragged
    })
    hex.addEventListener('change', () => {
      if (settings === null) return
      const typed = normalizeHex(hex.value)
      if (typed === null) hex.value = settings.focusBorderColor
      else commit({ ...settings, focusBorderColor: typed })
    })
    hex.addEventListener('blur', () => {
      if (settings !== null) hex.value = settings.focusBorderColor
    })

    control.append(select, hex, resetButton('focusBorder', 'focusBorderColor'))
    row.append(text, control)
    return row
  }

  /**
   * Language. Applied at startup only, so the row says so rather than pretending
   * the screen behind it will change.
   */
  function localeRow(value: string): HTMLElement {
    const row = document.createElement('div')
    row.className = 'settings__row'

    const text = document.createElement('div')
    text.className = 'settings__text'
    const label = document.createElement('span')
    label.textContent = t.settings.localeLabel
    const description = document.createElement('small')
    description.textContent = t.settings.localeDesc
    text.append(label, description)

    const control = document.createElement('div')
    control.className = 'settings__control'

    const select = document.createElement('select')
    select.className = 'settings__select'
    select.dataset['setting'] = 'locale'
    for (const [id, name] of [
      ['', t.settings.localeSystem],
      ['en', 'English'],
      ['ko', '한국어'],
    ] as const) {
      const option = document.createElement('option')
      option.value = id
      option.textContent = name
      select.append(option)
    }
    select.value = value
    select.addEventListener('change', () => {
      if (settings !== null) commit({ ...settings, locale: select.value })
    })

    control.append(select, resetButton('locale'))
    row.append(text, control)
    return row
  }

  function render(): void {
    if (settings === null) return
    const body = document.createElement('div')
    body.className = 'settings__body'

    // Title and close stay put; scrolling back up to close would be a chore.
    const bar = document.createElement('div')
    bar.className = 'settings__bar'
    const title = document.createElement('div')
    title.className = 'settings__title'
    title.textContent = t.settings.title
    const closeTop = document.createElement('button')
    closeTop.type = 'button'
    closeTop.className = 'button settings__close'
    closeTop.textContent = t.settings.close
    closeTop.addEventListener('click', () => hooks.onDismiss())

    // Tabs sit in the bar, which stays put — the shortcut list is long enough
    // that a strip scrolled away with the content would be unreachable.
    const tabs = document.createElement('div')
    tabs.className = 'settings__tabs'
    for (const [key, label] of [
      ['general', t.settings.tabGeneral],
      ['keys', t.settings.tabShortcuts],
    ] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'settings__tab'
      button.textContent = label
      button.dataset['tab'] = key
      if (tab === key) button.classList.add('settings__tab--on')
      button.addEventListener('click', () => {
        if (tab === key) return
        // Leaving mid-recording would keep swallowing keys on the other tab.
        keysPanel.cancelRecording()
        tab = key
        render()
        sheet.scrollTop = 0
      })
      tabs.append(button)
    }
    bar.append(title, tabs, closeTop)

    if (tab === 'keys') {
      body.append(bar, keysPanel.element)
      sheet.replaceChildren(body)
      return
    }

    const values = document.createElement('div')
    values.append(themeRow(settings.theme))
    values.append(fontRow(settings.fontFamily))
    for (const field of FIELDS) values.append(fieldRow(field, settings[field.key]))
    values.append(toggleRow(NOTIFICATIONS, settings.notifications))

    const appearance = document.createElement('div')
    appearance.append(fieldRow(APPEARANCE, settings.uiScale))
    appearance.append(focusBorderRow(settings.focusBorder, settings.focusBorderColor))
    appearance.append(localeRow(settings.locale))

    const toggles = document.createElement('div')
    for (const spec of TOGGLES) toggles.append(toggleRow(spec, settings[spec.key]))

    const keyboard = document.createElement('div')
    for (const spec of KEYBOARD) keyboard.append(toggleRow(spec, settings[spec.key]))

    const files = document.createElement('div')
    for (const [label, description, run] of [
      [t.settings.openSettingsFile, t.settings.settingsFilePath, () => api.openSettingsFile()],
      [t.settings.openSessionsDir, t.settings.sessionsDirPath, () => api.openSessionsDir()],
      [t.settings.openThemesDir, t.settings.themesDirPath, () => api.openThemesDir()],
    ] as const) {
      const row = document.createElement('div')
      row.className = 'settings__row'
      const text = document.createElement('div')
      text.className = 'settings__text'
      const name = document.createElement('span')
      name.textContent = label
      const path = document.createElement('small')
      path.textContent = description
      text.append(name, path)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'button'
      button.textContent = t.settings.openButton
      button.addEventListener('click', run)
      const control = document.createElement('div')
      control.className = 'settings__control'
      control.append(button)
      row.append(text, control)
      files.append(row)
    }

    const note = document.createElement('p')
    note.className = 'settings__note'
    note.textContent = t.settings.note

    body.append(
      bar,
      section(t.settings.sectionAppearance, appearance),
      section(t.settings.sectionTerminal, values),
      section(t.settings.sectionKeyboard, keyboard),
      section(t.settings.sectionMouse, toggles),
      section(t.settings.sectionFiles, files),
      ...(shellIntegration === null
        ? []
        : [section(t.settings.sectionShell, shellBody(shellIntegration))]),
      note,
    )
    sheet.replaceChildren(body)
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (layer.hidden) return
    // A row being recorded owns the whole keyboard, Esc included: that Esc
    // cancels the recording rather than closing the screen behind it.
    if (keysPanel.handleKey(event)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      hooks.onDismiss()
      return
    }
    /*
     * This listener is on window at capture, so stopping here stops the event
     * before the field it was typed into ever sees it. Sessions are inactive
     * while the screen is up, so there is nothing to shield them from anyway.
     */
    const target = event.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
    // Shortcuts must not leak through to the session behind.
    event.stopPropagation()
  }
  window.addEventListener('keydown', onKeyDown, true)

  return {
    get visible() {
      return !layer.hidden
    },
    open(next, nextBindings) {
      settings = next
      bindings = nextBindings
      render()
      layer.hidden = false
      sheet.scrollTop = 0
      // fc-list takes a moment; show the screen first and redraw that row later.
      if (monoFonts.length === 0) {
        void api.listMonoFonts().then((fonts) => {
          monoFonts = fonts
          if (!layer.hidden) render()
        })
      }
      // The folder can change between opens, so re-read each time.
      void api.listUserThemes().then((themes) => {
        userThemes = themes
        if (!layer.hidden) render()
      })
      // Panes come and go, so whether the hook is live is only true right now.
      void api.shellIntegrationStatus().then((status) => {
        shellIntegration = status
        if (!layer.hidden) render()
      })
    },
    close() {
      keysPanel.cancelRecording()
      layer.hidden = true
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown, true)
      keysPanel.destroy()
      layer.remove()
    },
  }
}
