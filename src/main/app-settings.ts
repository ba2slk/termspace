/**
 * App settings. Unlike session files, the app owns this one and writes to it.
 * Still YAML so it can be edited by hand and tracked in git.
 */
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse as parseYaml, stringify } from 'yaml'
import type { AppSettings } from '../shared/protocol'
import { DEFAULT_SETTINGS } from '../shared/settings-defaults'
import { configDir } from './config-dir'

export { DEFAULT_SETTINGS }

/** What the focused pane's border may follow. */
export const FOCUS_BORDER_MODES = ['white', 'palette', 'custom'] as const

/** Interface languages with a catalogue. Empty means the system's. */
export const LOCALES = ['', 'en', 'ko'] as const

/** Bounds for numeric settings, shared by the settings screen and file validation. */
export const SETTING_LIMITS = {
  defaultColumnWidth: { min: 240, max: 3000, step: 20 },
  fontSize: { min: 9, max: 24, step: 1 },
  lineHeight: { min: 1, max: 2, step: 0.05 },
  scrollback: { min: 200, max: 100_000, step: 500 },
  scrollBoost: { min: 1, max: 12, step: 0.5 },
  sidebarWidth: { min: 160, max: 420, step: 10 },
  // 0 or 1 — numeric throughout so hand-edited files stay consistent.
  sidebarVisible: { min: 0, max: 1, step: 1 },
  copyOnSelect: { min: 0, max: 1, step: 1 },
  shiftPanning: { min: 0, max: 1, step: 1 },
  barPanning: { min: 0, max: 1, step: 1 },
  paneLabels: { min: 0, max: 1, step: 1 },
  idleDim: { min: 0, max: 60, step: 5 },
  notifications: { min: 0, max: 1, step: 1 },
  // Below 80 the chrome stops being readable; above 160 it crowds out the canvas.
  uiScale: { min: 80, max: 160, step: 5 },
} as const

export function settingsFile(env: NodeJS.ProcessEnv): string {
  return join(configDir(env), 'settings.yaml')
}

type NumericKey = keyof typeof SETTING_LIMITS

function clampNumber(value: unknown, key: NumericKey): number {
  const limit = SETTING_LIMITS[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS[key]
  return Math.min(limit.max, Math.max(limit.min, value))
}

/** Font name. Goes straight into a CSS declaration, so restrict the characters. */
function cleanFontFamily(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.fontFamily
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > 80) return DEFAULT_SETTINGS.fontFamily
  return /^[\p{L}\p{N} ._-]+$/u.test(trimmed) ? trimmed : DEFAULT_SETTINGS.fontFamily
}

/** Theme id. Compared against file names, so keep it path-safe. */
function cleanId(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > 64) return ''
  return /^[\p{L}\p{N}._-]+$/u.test(trimmed) ? trimmed : ''
}

/** Anything that is not a catalogue we ship falls back to following the system. */
function cleanLocale(value: unknown): string {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value) ? value : ''
}

function cleanFocusBorder(value: unknown): string {
  return typeof value === 'string' && (FOCUS_BORDER_MODES as readonly string[]).includes(value)
    ? value
    : DEFAULT_SETTINGS.focusBorder
}

/** Reaches a CSS declaration, so nothing but a plain hex colour gets through. */
function cleanHexColor(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.focusBorderColor
  const trimmed = value.trim().toLowerCase()
  return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : DEFAULT_SETTINGS.focusBorderColor
}

/** Unknown keys and out-of-range values fall back to defaults. */
export function normalizeSettings(raw: unknown): AppSettings {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const input = raw as Record<string, unknown>
  return {
    defaultColumnWidth: clampNumber(input['defaultColumnWidth'], 'defaultColumnWidth'),
    fontSize: clampNumber(input['fontSize'], 'fontSize'),
    lineHeight: clampNumber(input['lineHeight'], 'lineHeight'),
    scrollback: clampNumber(input['scrollback'], 'scrollback'),
    scrollBoost: clampNumber(input['scrollBoost'], 'scrollBoost'),
    sidebarWidth: clampNumber(input['sidebarWidth'], 'sidebarWidth'),
    sidebarVisible: Math.round(clampNumber(input['sidebarVisible'], 'sidebarVisible')),
    copyOnSelect: Math.round(clampNumber(input['copyOnSelect'], 'copyOnSelect')),
    shiftPanning: Math.round(clampNumber(input['shiftPanning'], 'shiftPanning')),
    barPanning: Math.round(clampNumber(input['barPanning'], 'barPanning')),
    paneLabels: Math.round(clampNumber(input['paneLabels'], 'paneLabels')),
    idleDim: clampNumber(input['idleDim'], 'idleDim'),
    notifications: Math.round(clampNumber(input['notifications'], 'notifications')),
    fontFamily: cleanFontFamily(input['fontFamily']),
    theme: cleanId(input['theme']),
    uiScale: clampNumber(input['uiScale'], 'uiScale'),
    focusBorder: cleanFocusBorder(input['focusBorder']),
    focusBorderColor: cleanHexColor(input['focusBorderColor']),
    locale: cleanLocale(input['locale']),
  }
}

const HEADER = `# Termspace settings
#
# Changes made in the settings screen (Ctrl+,) rewrite this file.
# Editing it by hand also works; restart the app to apply.
#
# defaultColumnWidth  default width for new columns (px). A session file's width wins.
# fontSize            terminal font size (px)
# lineHeight          line height multiplier
# scrollback          lines of past output each pane remembers
# scrollBoost         distance per wheel tick. Rolling continuously adds up to 2.4x more.
# sidebarWidth        session list width (px)
# sidebarVisible      1 keeps it open, 0 keeps it collapsed (Alt+S)
# copyOnSelect        1 copies as soon as a mouse selection is made
# shiftPanning        1 pans the canvas horizontally with Shift+wheel
# barPanning          1 pans the canvas by wheeling over the centre title
# paneLabels          1 shows every pane's title while the move key is held (Alt, Cmd on macOS)
# idleDim             how much unfocused panes are dimmed (%)
# notifications       1 lets a program's OSC 9 / OSC 777 reach the desktop, unless you are watching that pane
# fontFamily          terminal font. Empty uses the default stack
# theme               terminal palette. Empty uses the default colours
# uiScale             size of the app's own text and title bar (%). Not the terminal's
# focusBorder         what colours the focused pane's border: white, palette, or custom
# focusBorderColor    the colour custom uses, as #rrggbb
# locale              interface language: en, ko, or empty to follow the system
`

/**
 * The same read, blocking.
 *
 * Only the locale needs this: it has to reach the renderer in the page URL,
 * which is fixed before the window is created and cannot wait on a promise.
 */
export function loadSettingsSync(env: NodeJS.ProcessEnv): AppSettings {
  try {
    return normalizeSettings(parseYaml(readFileSync(settingsFile(env), 'utf8')))
  } catch {
    return { ...DEFAULT_SETTINGS } // Missing or malformed — use defaults
  }
}

export async function loadSettings(env: NodeJS.ProcessEnv): Promise<AppSettings> {
  try {
    return normalizeSettings(parseYaml(await readFile(settingsFile(env), 'utf8')))
  } catch {
    return { ...DEFAULT_SETTINGS } // Missing or malformed — use defaults
  }
}

export async function saveSettings(
  env: NodeJS.ProcessEnv,
  raw: unknown,
): Promise<AppSettings> {
  const settings = normalizeSettings(raw)
  const path = settingsFile(env)
  await mkdir(dirname(path), { recursive: true })

  // Let the YAML writer decide quoting — font names contain spaces.
  await writeFile(path, `${HEADER}\n${stringify(settings, { lineWidth: 0 })}`, 'utf8')
  return settings
}
