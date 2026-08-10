/**
 * Which key chords run which action. Pure, and shared: the renderer resolves
 * keys with it, the main process validates the file against it.
 *
 * A chord is a canonical string — modifiers in a fixed order, then the physical
 * `code`: `Ctrl+Alt+Shift+Meta+KeyU`. Matching on `code` rather than `key` is
 * what keeps a binding working under any keyboard layout.
 *
 * `Meta` is Cmd on macOS. Off mac the same physical key is Super and belongs to
 * the window manager, so a Meta chord there never matches a key press — but it
 * still parses, so one keybindings file can serve both platforms.
 */

export type ActionId =
  | 'focus-left'
  | 'focus-right'
  | 'focus-up'
  | 'focus-down'
  | 'resize-left'
  | 'resize-right'
  | 'resize-up'
  | 'resize-down'
  | 'move-left'
  | 'move-right'
  | 'move-up'
  | 'move-down'
  | 'split-up'
  | 'split-down'
  | 'add-column-left'
  | 'add-column-right'
  | 'close-pane'
  | 'reveal-focus'
  | 'overview'
  | 'search'
  | 'copy'
  | 'paste'
  | 'toggle-sidebar'
  | 'goto-session'
  | 'prev-session'
  | 'next-session'
  | 'settings'
  | 'save-layout'
  | 'fullscreen'
  | 'font-increase'
  | 'font-decrease'
  | 'font-reset'

export type Bindings = Readonly<Record<ActionId, readonly string[]>>

/**
 * The nine session shortcuts are one action, not nine.
 *
 * `Digit1`..`Digit9` and their numpad twins all normalize to this code, so the
 * whole row rebinds at once and no half-bound state can exist.
 */
export const DIGIT_CODE = 'Digit#'

export const DEFAULT_BINDINGS: Bindings = {
  'focus-left': ['Alt+ArrowLeft'],
  'focus-right': ['Alt+ArrowRight'],
  'focus-up': ['Alt+ArrowUp'],
  'focus-down': ['Alt+ArrowDown'],
  // Two chords each: the home row for typists, the arrows for everyone else.
  'resize-left': ['Alt+KeyU', 'Ctrl+Alt+ArrowLeft'],
  'resize-down': ['Alt+KeyI', 'Ctrl+Alt+ArrowDown'],
  'resize-up': ['Alt+KeyO', 'Ctrl+Alt+ArrowUp'],
  'resize-right': ['Alt+KeyP', 'Ctrl+Alt+ArrowRight'],
  'move-left': ['Alt+Shift+KeyU'],
  'move-down': ['Alt+Shift+KeyI'],
  'move-up': ['Alt+Shift+KeyO'],
  'move-right': ['Alt+Shift+KeyP'],
  'split-up': ['Alt+Shift+ArrowUp'],
  'split-down': ['Alt+Shift+ArrowDown'],
  'add-column-left': ['Alt+Shift+ArrowLeft'],
  'add-column-right': ['Alt+Shift+ArrowRight'],
  'close-pane': ['Alt+Shift+KeyW'],
  'reveal-focus': ['Alt+KeyG'],
  overview: ['Alt+KeyM'],
  search: ['Ctrl+Shift+KeyF'],
  copy: ['Ctrl+Shift+KeyC'],
  paste: ['Ctrl+Shift+KeyV'],
  'toggle-sidebar': ['Alt+KeyS'],
  'goto-session': [`Alt+${DIGIT_CODE}`],
  // The arrows are spent — Ctrl+Alt+Shift+Arrow is the desktop's own.
  'prev-session': ['Alt+Shift+Comma'],
  'next-session': ['Alt+Shift+Period'],
  settings: ['Ctrl+Comma'],
  // Next to Alt+S for the sidebar: both are about the session as a whole.
  'save-layout': ['Alt+Shift+KeyS'],
  fullscreen: ['F11'],
  // On most layouts + is Shift+=, so Ctrl++ arrives with Shift held.
  'font-increase': ['Ctrl+Equal', 'Ctrl+Shift+Equal', 'Ctrl+NumpadAdd'],
  'font-decrease': ['Ctrl+Minus', 'Ctrl+NumpadSubtract'],
  'font-reset': ['Ctrl+Digit0', 'Ctrl+Numpad0'],
}

export type ActionGroup = 'pane' | 'layout' | 'terminal' | 'app'

/** Display order for the settings list. Every action appears exactly once. */
export const ACTION_GROUPS: readonly { readonly group: ActionGroup; readonly ids: readonly ActionId[] }[] = [
  {
    group: 'pane',
    ids: ['focus-left', 'focus-right', 'focus-up', 'focus-down', 'reveal-focus', 'overview'],
  },
  {
    group: 'layout',
    ids: [
      'split-up',
      'split-down',
      'add-column-left',
      'add-column-right',
      'close-pane',
      'resize-left',
      'resize-right',
      'resize-up',
      'resize-down',
      'move-left',
      'move-right',
      'move-up',
      'move-down',
    ],
  },
  {
    group: 'terminal',
    ids: ['copy', 'paste', 'search', 'font-increase', 'font-decrease', 'font-reset'],
  },
  {
    group: 'app',
    ids: [
      'toggle-sidebar',
      'goto-session',
      'prev-session',
      'next-session',
      'save-layout',
      'settings',
      'fullscreen',
    ],
  },
]

export const ACTION_IDS: readonly ActionId[] = ACTION_GROUPS.flatMap((entry) => entry.ids)

/** At most this many chords per action — the row has to stay readable. */
export const MAX_CHORDS = 4

const CODE_PATTERN = new RegExp(
  '^(?:' +
    [
      'Key[A-Z]',
      'Digit[0-9]',
      'Numpad[0-9]',
      'Numpad(?:Add|Subtract|Multiply|Divide|Decimal|Enter)',
      'F(?:[1-9]|1[0-2])',
      'Arrow(?:Left|Right|Up|Down)',
      'Comma|Period|Slash|Semicolon|Quote|Backquote|Backslash',
      'Bracket(?:Left|Right)',
      'Minus|Equal|Space|Enter|Tab|Backspace|Escape',
      'Home|End|PageUp|PageDown|Insert|Delete',
    ].join('|') +
    ')$',
)

function isCode(code: string): boolean {
  return code === DIGIT_CODE || CODE_PATTERN.test(code)
}

export interface KeyChord {
  readonly code: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly metaKey: boolean
}

/** Digit1..Digit9 and their numpad twins collapse onto one code. */
function collapseDigit(code: string): string {
  return /^(?:Digit|Numpad)[1-9]$/.test(code) ? DIGIT_CODE : code
}

/** Zero-based session index, or null when the code is not one of the nine. */
export function digitIndex(code: string): number | null {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(code)
  return match === null ? null : Number(match[1]) - 1
}

/**
 * A pressed key as a chord string, or null when it cannot be one — a bare
 * modifier, or anything held with Super.
 */
export function chordFromEvent(event: KeyChord, isMac = false): string | null {
  // Off mac, Meta is Super and belongs to the window manager.
  if (event.metaKey && !isMac) return null
  const code = collapseDigit(event.code)
  if (!isCode(code)) return null
  return (
    (event.ctrlKey ? 'Ctrl+' : '') +
    (event.altKey ? 'Alt+' : '') +
    (event.shiftKey ? 'Shift+' : '') +
    (event.metaKey ? 'Meta+' : '') +
    code
  )
}

/**
 * A chord string from a file, in canonical form. Order and case of the
 * modifiers are forgiving; the code is not — it has to be a real `code`.
 */
export function parseChord(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const parts = text.trim().split('+').filter((part) => part !== '')
  if (parts.length === 0) return null
  const code = collapseDigit(parts[parts.length - 1] as string)
  if (!isCode(code)) return null

  let ctrlKey = false
  let altKey = false
  let shiftKey = false
  let metaKey = false
  for (const part of parts.slice(0, -1)) {
    switch (part.toLowerCase()) {
      case 'ctrl':
      case 'control':
        ctrlKey = true
        break
      case 'alt':
      case 'option':
        altKey = true
        break
      case 'shift':
        shiftKey = true
        break
      case 'meta':
      case 'cmd':
      case 'command':
        metaKey = true
        break
      default:
        return null // Super, or a typo. Either way the binding is not usable.
    }
  }
  // Always the permissive form: a mac chord in a Linux file is inert, not
  // invalid, so the platform filter belongs at key-press time, not read time.
  return chordFromEvent({ code, ctrlKey, altKey, shiftKey, metaKey }, true)
}

const CODE_LABEL: Readonly<Record<string, string>> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Space: 'Space',
  NumpadAdd: 'Numpad +',
  NumpadSubtract: 'Numpad -',
  NumpadMultiply: 'Numpad *',
  NumpadDivide: 'Numpad /',
  NumpadDecimal: 'Numpad .',
  NumpadEnter: 'Numpad Enter',
  [DIGIT_CODE]: '1~9',
}

function codeLabel(code: string): string {
  const known = CODE_LABEL[code]
  if (known !== undefined) return known
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`
  return code
}

const MAC_MOD: Readonly<Record<string, string>> = {
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Meta: '⌘',
}

/**
 * What the user sees on the chip. Modifier names are the same in both locales.
 *
 * Spaced around the plus: `Alt+→` runs the modifier into an arrow that is
 * itself a symbol, and the eye has to separate them. `Alt + →` does it for you.
 * macOS spells its own chords in symbols with nothing between them, and a mac
 * user reads `⇧⌘W` faster than any spelled-out form.
 */
export function formatChord(chord: string, isMac = false): string {
  const parts = chord.split('+')
  const code = parts[parts.length - 1] as string
  const mods = parts.slice(0, -1)
  if (isMac) return mods.map((mod) => MAC_MOD[mod] ?? mod).join('') + codeLabel(code)
  return [...mods.map((mod) => (mod === 'Meta' ? 'Cmd' : mod)), codeLabel(code)].join(' + ')
}

/**
 * Why a chord is a bad idea — the terminal, not the app, normally owns it.
 * Advisory only: the warning is shown and the binding is still saved.
 */
export type ChordRisk = 'control-char' | 'shell-word' | 'plain-key'

export function chordRisk(chord: string): ChordRisk | null {
  const parts = chord.split('+')
  const code = parts[parts.length - 1] as string
  const mods = new Set(parts.slice(0, -1))
  const only = (...names: string[]): boolean =>
    mods.size === names.length && names.every((name) => mods.has(name))

  // Ctrl+letter is a control character on the wire: Ctrl+C is SIGINT.
  if (only('Ctrl') && /^Key[A-Z]$/.test(code)) return 'control-char'
  // Readline's word motions, which every shell inherits.
  if (only('Alt') && (code === 'KeyB' || code === 'KeyF')) return 'shell-word'
  // Anything unmodified is typing, apart from the function keys.
  if (mods.size === 0 && !/^F(?:[1-9]|1[0-2])$/.test(code)) return 'plain-key'
  return null
}

/** Chords bound to more than one action, each with the actions that claim it. */
export function findConflicts(bindings: Bindings): ReadonlyMap<string, readonly ActionId[]> {
  const claims = new Map<string, ActionId[]>()
  for (const id of ACTION_IDS) {
    for (const chord of bindings[id]) {
      const list = claims.get(chord)
      if (list === undefined) claims.set(chord, [id])
      else if (!list.includes(id)) list.push(id)
    }
  }
  const conflicts = new Map<string, readonly ActionId[]>()
  for (const [chord, ids] of claims) if (ids.length > 1) conflicts.set(chord, ids)
  return conflicts
}

/** Chord string to action, for resolving a key press in one lookup. */
export function buildLookup(bindings: Bindings): ReadonlyMap<string, ActionId> {
  const lookup = new Map<string, ActionId>()
  for (const id of ACTION_IDS) {
    // First claim wins, so a conflict cannot make a key do two things.
    for (const chord of bindings[id]) if (!lookup.has(chord)) lookup.set(chord, id)
  }
  return lookup
}

export function isDefault(bindings: Bindings, id: ActionId): boolean {
  const mine = bindings[id]
  const theirs = DEFAULT_BINDINGS[id]
  return mine.length === theirs.length && mine.every((chord, i) => chord === theirs[i])
}

/** Only what differs from the defaults, which is all the file needs to hold. */
export function changedBindings(bindings: Bindings): Record<string, readonly string[]> {
  const changed: Record<string, readonly string[]> = {}
  for (const id of ACTION_IDS) if (!isDefault(bindings, id)) changed[id] = bindings[id]
  return changed
}

/**
 * A file's contents as usable bindings. Unknown actions and unusable chords are
 * dropped rather than rejected — one bad line must not cost the user the rest.
 */
export function normalizeBindings(raw: unknown): Bindings {
  const input = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const result: Record<string, readonly string[]> = {}
  for (const id of ACTION_IDS) {
    const value = input[id]
    if (value === undefined) {
      result[id] = DEFAULT_BINDINGS[id]
      continue
    }
    // A single string is what a hand-written file most often holds.
    const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
    const chords: string[] = []
    for (const entry of list) {
      const chord = parseChord(entry)
      if (chord !== null && !chords.includes(chord)) chords.push(chord)
      if (chords.length === MAX_CHORDS) break
    }
    // An empty list is a real choice: the action has no key at all.
    result[id] = chords
  }
  return result as Bindings
}

export function withChords(bindings: Bindings, id: ActionId, chords: readonly string[]): Bindings {
  return { ...bindings, [id]: chords.slice(0, MAX_CHORDS) }
}
