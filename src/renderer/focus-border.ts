/**
 * What colours the focused pane's border.
 *
 * Pure: the setting and the palette in, two CSS values out. The white mode is
 * the absence of an answer — the chrome's own tokens already say it, and
 * repeating them here would mean two places to change one colour.
 */
import type { AppSettings } from '../shared/protocol'
import type { TerminalTheme } from '../shared/terminal-themes'

export interface FocusBorder {
  /** The border itself. */
  readonly border: string
  /** The 1px ring outside it: the same colour, thinned. */
  readonly ring: string
}

/** How much of the border colour the ring keeps, mirroring the tokens' relation. */
const RING_ALPHA = 45

/**
 * A typed hex, made storable: `abc123` and `#ABC123` are the same colour.
 * Null for anything that is not six hex digits.
 */
export function normalizeHex(input: string): string | null {
  const trimmed = input.trim().toLowerCase()
  const body = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
  return /^[0-9a-f]{6}$/.test(body) ? `#${body}` : null
}

/** Null means "leave the tokens alone", which is what white mode is. */
export function resolveFocusBorder(
  settings: AppSettings,
  theme: TerminalTheme,
): FocusBorder | null {
  const color =
    settings.focusBorder === 'palette'
      ? // A palette written before accents existed names none; its blue is what
        // the file itself would have said.
        theme.accent === '' ? theme.blue : theme.accent
      : settings.focusBorder === 'custom'
        ? normalizeHex(settings.focusBorderColor)
        : null
  if (color === null) return null
  return { border: color, ring: `color-mix(in srgb, ${color} ${String(RING_ALPHA)}%, transparent)` }
}
