/**
 * The stock value of every setting.
 *
 * Shared rather than owned by main: the settings screen needs it to tell a row
 * that has been changed from one that never was, and the renderer cannot reach
 * into main.
 */
import type { AppSettings } from './protocol'

export const DEFAULT_SETTINGS: AppSettings = {
  defaultColumnWidth: 640,
  fontSize: 13,
  lineHeight: 1.35,
  scrollback: 5000,
  scrollBoost: 4,
  sidebarWidth: 220,
  sidebarVisible: 1,
  copyOnSelect: 1,
  shiftPanning: 1,
  barPanning: 1,
  paneLabels: 1,
  idleDim: 15,
  // A program asking to be noticed reaches the desktop by default; the bell
  // never does.
  notifications: 1,
  inheritWorkingDir: 1,
  // Empty means the app's default stack — naming a font that may not exist
  // would fail silently on other machines.
  fontFamily: '',
  // Empty means the default palette; an unknown name also falls back.
  theme: '',
  uiScale: 100,
  // The chrome's own white highlight: exactly what the app looked like before
  // this setting existed.
  focusBorder: 'white',
  // Only read in custom mode, but a sensible starting point once it is picked:
  // the default palette's blue.
  focusBorderColor: '#7a9bbf',
  // Empty follows the system locale.
  locale: '',
  // What other terminals draw. 'subpixel' is the pre-1.1 look, kept for eyes
  // used to it.
  textRendering: 'grayscale',
  updateCheck: 1,
}

/** True when this key still holds what the app ships with. */
export function isDefaultSetting<K extends keyof AppSettings>(
  settings: AppSettings,
  key: K,
): boolean {
  return settings[key] === DEFAULT_SETTINGS[key]
}
