/**
 * Key chords to app actions.
 *
 * In a terminal nearly every modifier combination already belongs to the
 * terminal, so a chord that is not bound is not handled — it passes through.
 *
 * Which chord runs which action is data (`shared/keybindings`), because the
 * settings screen edits it. This module only turns an action id into the action
 * the app runs, and answers who should run it.
 */
import {
  buildLookup,
  chordFromEvent,
  DEFAULT_BINDINGS,
  digitIndex,
  type ActionId,
  type Bindings,
  type KeyChord,
} from '../shared/keybindings'
import type { Direction } from './layout-model'

export type { KeyChord }

export type Action =
  | { readonly t: 'focus'; readonly dir: Direction }
  | { readonly t: 'resize'; readonly dir: Direction }
  /** Move the focused pane itself, pty and all. */
  | { readonly t: 'move'; readonly dir: Direction }
  /** Split within the column. */
  | { readonly t: 'split'; readonly side: 'up' | 'down' }
  /** Add a column to either side. */
  | { readonly t: 'add-column'; readonly side: 'left' | 'right' }
  | { readonly t: 'close-pane' }
  | { readonly t: 'toggle-sidebar' }
  /** Jump to the nth session in the sidebar, zero-based. */
  | { readonly t: 'goto-session'; readonly index: number }
  /** Step to the session before or after this one, among those running. */
  | { readonly t: 'step-session'; readonly delta: 1 | -1 }
  | { readonly t: 'fullscreen' }
  | { readonly t: 'settings' }
  /** Write the open session's own file, the way the title bar's button does. */
  | { readonly t: 'save-layout' }
  | { readonly t: 'copy' }
  | { readonly t: 'paste' }
  /** Search the focused pane's scrollback. */
  | { readonly t: 'search' }
  /** Zoomed-out map of the current session's canvas. */
  | { readonly t: 'overview' }
  /** Bring the focused pane back into view after scrolling away from it. */
  | { readonly t: 'reveal-focus' }
  /** Step the terminal font size, saved like any settings change. */
  | { readonly t: 'font-size'; readonly delta: 1 | -1 }
  | { readonly t: 'font-reset' }

/**
 * Actions the app handles rather than a session.
 *
 * Everything else needs a focused pane to mean anything. These make sense with
 * no session open, so a session must not own them.
 */
export function isAppAction(action: Action): boolean {
  return (
    action.t === 'toggle-sidebar' ||
    action.t === 'settings' ||
    // Needs a session, but the app owns it: it writes the session's file rather
    // than doing anything to a pane.
    action.t === 'save-layout' ||
    action.t === 'fullscreen' ||
    action.t === 'goto-session' ||
    action.t === 'step-session' ||
    action.t === 'font-size' ||
    action.t === 'font-reset'
  )
}

/** Everything except the session jump, which needs the digit that was pressed. */
const FIXED_ACTION: Partial<Readonly<Record<ActionId, Action>>> = {
  'focus-left': { t: 'focus', dir: 'left' },
  'focus-right': { t: 'focus', dir: 'right' },
  'focus-up': { t: 'focus', dir: 'up' },
  'focus-down': { t: 'focus', dir: 'down' },
  'resize-left': { t: 'resize', dir: 'left' },
  'resize-right': { t: 'resize', dir: 'right' },
  'resize-up': { t: 'resize', dir: 'up' },
  'resize-down': { t: 'resize', dir: 'down' },
  'move-left': { t: 'move', dir: 'left' },
  'move-right': { t: 'move', dir: 'right' },
  'move-up': { t: 'move', dir: 'up' },
  'move-down': { t: 'move', dir: 'down' },
  'split-up': { t: 'split', side: 'up' },
  'split-down': { t: 'split', side: 'down' },
  'add-column-left': { t: 'add-column', side: 'left' },
  'add-column-right': { t: 'add-column', side: 'right' },
  'close-pane': { t: 'close-pane' },
  'reveal-focus': { t: 'reveal-focus' },
  overview: { t: 'overview' },
  search: { t: 'search' },
  copy: { t: 'copy' },
  paste: { t: 'paste' },
  'toggle-sidebar': { t: 'toggle-sidebar' },
  'prev-session': { t: 'step-session', delta: -1 },
  'next-session': { t: 'step-session', delta: 1 },
  settings: { t: 'settings' },
  'save-layout': { t: 'save-layout' },
  fullscreen: { t: 'fullscreen' },
  'font-increase': { t: 'font-size', delta: 1 },
  'font-decrease': { t: 'font-size', delta: -1 },
  'font-reset': { t: 'font-reset' },
}

/**
 * Rebuilding the lookup on every key press would be wasteful, and the bindings
 * object is replaced rather than mutated whenever it changes.
 */
let cachedFor: Bindings = DEFAULT_BINDINGS
let cachedLookup = buildLookup(DEFAULT_BINDINGS)

function lookupFor(bindings: Bindings): ReadonlyMap<string, ActionId> {
  if (bindings !== cachedFor) {
    cachedFor = bindings
    cachedLookup = buildLookup(bindings)
  }
  return cachedLookup
}

/** null means the key belongs to the focused pane's pty. */
export function resolveAction(chord: KeyChord, bindings: Bindings = DEFAULT_BINDINGS): Action | null {
  const text = chordFromEvent(chord)
  if (text === null) return null
  const id = lookupFor(bindings).get(text)
  if (id === undefined) return null

  if (id === 'goto-session') {
    const index = digitIndex(chord.code)
    // A hand-edited file can put this action on a key with no session number.
    return index === null ? null : { t: 'goto-session', index }
  }
  return FIXED_ACTION[id] ?? null
}
