/**
 * Whether the pane-move modifier is being held down.
 *
 * The key is the one that prefixes the focus-move chords: Alt off mac, Cmd on
 * it. It is tracked as its own boolean rather than read off the last event's
 * modifier flags, so the arrow keydown inside an Alt+Arrow chord neither turns
 * it on nor off — only the modifier's own keydown and keyup move it.
 */

export type PeekEvent =
  | { readonly t: 'keydown'; readonly code: string }
  | { readonly t: 'keyup'; readonly code: string }
  /** The window lost focus. A keyup that never arrives must not leave it stuck. */
  | { readonly t: 'blur' }

export function isPeekKey(code: string, isMac: boolean): boolean {
  return isMac
    ? code === 'MetaLeft' || code === 'MetaRight'
    : code === 'AltLeft' || code === 'AltRight'
}

export function nextPeek(held: boolean, event: PeekEvent, isMac: boolean): boolean {
  if (event.t === 'blur') return false
  if (!isPeekKey(event.code, isMac)) return held
  return event.t === 'keydown'
}
