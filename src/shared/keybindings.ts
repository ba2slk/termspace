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

/**
 * The mac table mirrors onto Cmd. Option is left to the terminal (it types
 * characters and serves as readline Meta), and the system's own Cmd+Q/W/H/M
 * are never claimed. Where a mac convention exists (Cmd+C/V/F/S/comma,
 * Cmd+1..9, Cmd+Shift+[ ]), it wins over a mechanical mirror.
 */
export const DEFAULT_BINDINGS_MAC: Bindings = {
  'focus-left': ['Meta+ArrowLeft'],
  'focus-right': ['Meta+ArrowRight'],
  'focus-up': ['Meta+ArrowUp'],
  'focus-down': ['Meta+ArrowDown'],
  'resize-left': ['Meta+KeyU', 'Ctrl+Meta+ArrowLeft'],
  'resize-down': ['Meta+KeyI', 'Ctrl+Meta+ArrowDown'],
  'resize-up': ['Meta+KeyO', 'Ctrl+Meta+ArrowUp'],
  'resize-right': ['Meta+KeyP', 'Ctrl+Meta+ArrowRight'],
  'move-left': ['Shift+Meta+KeyU'],
  'move-down': ['Shift+Meta+KeyI'],
  'move-up': ['Shift+Meta+KeyO'],
  'move-right': ['Shift+Meta+KeyP'],
  'split-up': ['Shift+Meta+ArrowUp'],
  'split-down': ['Shift+Meta+ArrowDown'],
  'add-column-left': ['Shift+Meta+ArrowLeft'],
  'add-column-right': ['Shift+Meta+ArrowRight'],
  'close-pane': ['Shift+Meta+KeyW'],
  'reveal-focus': ['Meta+KeyG'],
  // Cmd+M minimizes; the overview moves behind Shift.
  overview: ['Shift+Meta+KeyM'],
  search: ['Meta+KeyF'],
  copy: ['Meta+KeyC'],
  paste: ['Meta+KeyV'],
  'toggle-sidebar': ['Meta+KeyB'],
  'goto-session': [`Meta+${DIGIT_CODE}`],
  'prev-session': ['Shift+Meta+BracketLeft'],
  'next-session': ['Shift+Meta+BracketRight'],
  settings: ['Meta+Comma'],
  'save-layout': ['Meta+KeyS'],
  fullscreen: ['Ctrl+Meta+KeyF'],
  // On most layouts + is Shift+=, so Cmd++ arrives with Shift held.
  'font-increase': ['Meta+Equal', 'Shift+Meta+Equal', 'Meta+NumpadAdd'],
  'font-decrease': ['Meta+Minus', 'Meta+NumpadSubtract'],
  'font-reset': ['Meta+Digit0', 'Meta+Numpad0'],
}

export function defaultBindingsFor(isMac: boolean): Bindings {
  return isMac ? DEFAULT_BINDINGS_MAC : DEFAULT_BINDINGS
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
 * macOS uses its own symbols for the modifiers, spaced the same way: run them
 * together and `⌘G` reads as one glyph rather than a key and its modifier.
 */
export function formatChord(chord: string, isMac = false): string {
  const parts = chord.split('+')
  const code = parts[parts.length - 1] as string
  const mods = parts.slice(0, -1)
  if (isMac) return [...mods.map((mod) => MAC_MOD[mod] ?? mod), codeLabel(code)].join(' + ')
  return [...mods.map((mod) => (mod === 'Meta' ? 'Cmd' : mod)), codeLabel(code)].join(' + ')
}

/**
 * Why a chord is a bad idea — the terminal, not the app, normally owns it.
 * Advisory only: the warning is shown and the binding is still saved.
 */
export type ChordRisk = 'control-char' | 'shell-word' | 'plain-key' | 'system-key'

/**
 * The two actions the mac Edit menu delivers, and the keys it delivers them
 * with. Fixed on mac: the menu holds the accelerators, so these rows cannot be
 * edited and no other action may claim the chords.
 */
export const MENU_OWNED_ACTIONS: readonly ActionId[] = ['copy', 'paste']
const MENU_OWNED_CHORDS: readonly string[] = ['Meta+KeyC', 'Meta+KeyV']

/** True for the rows the settings screen must draw as fixed rather than editable. */
export function isMenuOwned(id: ActionId, isMac: boolean): boolean {
  return isMac && MENU_OWNED_ACTIONS.includes(id)
}

export function chordRisk(chord: string, isMac = false): ChordRisk | null {
  const parts = chord.split('+')
  const code = parts[parts.length - 1] as string
  const mods = new Set(parts.slice(0, -1))
  const only = (...names: string[]): boolean =>
    mods.size === names.length && names.every((name) => mods.has(name))

  // Ctrl+letter is a control character on the wire: Ctrl+C is SIGINT.
  if (only('Ctrl') && /^Key[A-Z]$/.test(code)) return 'control-char'
  if (isMac && only('Meta')) {
    // mac hands these to the menu bar before the page ever sees the key.
    if (code === 'KeyQ' || code === 'KeyW' || code === 'KeyH' || code === 'KeyM') return 'system-key'
  }
  // Readline's word motions, which every shell inherits. Not on mac: the mac
  // table leaves Option to the terminal, so an Option chord there is the
  // user's own deliberate choice, not a collision the defaults walked into.
  if (!isMac && only('Alt') && (code === 'KeyB' || code === 'KeyF')) return 'shell-word'
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

export function isDefault(bindings: Bindings, id: ActionId, isMac = false): boolean {
  const mine = bindings[id]
  const theirs = defaultBindingsFor(isMac)[id]
  return mine.length === theirs.length && mine.every((chord, i) => chord === theirs[i])
}

/** Only what differs from the defaults, which is all the file needs to hold. */
export function changedBindings(
  bindings: Bindings,
  isMac = false,
): Record<string, readonly string[]> {
  const changed: Record<string, readonly string[]> = {}
  for (const id of ACTION_IDS) if (!isDefault(bindings, id, isMac)) changed[id] = bindings[id]
  return changed
}

/**
 * A file's contents as usable bindings. Unknown actions and unusable chords are
 * dropped rather than rejected — one bad line must not cost the user the rest.
 */
export function normalizeBindings(raw: unknown, isMac = false): Bindings {
  const input = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const defaults = defaultBindingsFor(isMac)
  const result: Record<string, readonly string[]> = {}
  for (const id of ACTION_IDS) {
    // On mac the Edit menu owns Cmd+C/V and delivers them itself, so the file
    // cannot move, unbind or lend those keys — it would describe a key press
    // the app never gets to decide.
    if (isMac && MENU_OWNED_ACTIONS.includes(id)) {
      result[id] = defaults[id]
      continue
    }
    const value = input[id]
    if (value === undefined) {
      result[id] = defaults[id]
      continue
    }
    // A single string is what a hand-written file most often holds.
    const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
    const chords: string[] = []
    for (const entry of list) {
      const chord = parseChord(entry)
      if (chord === null || chords.includes(chord)) continue
      if (isMac && MENU_OWNED_CHORDS.includes(chord)) continue
      chords.push(chord)
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
