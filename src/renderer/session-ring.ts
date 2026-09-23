/**
 * Which session a shortcut lands on: stepping through the open ones, and the
 * numbered keys.
 *
 * The ring is whatever is running, in the order the list shows it, so the step
 * follows the eye. It wraps: with two or three sessions open, reversing
 * direction at an end is a chore the shortcut should not ask for.
 */

/** The session a step lands on, or null when there is nowhere to go. */
export function stepSession(
  ids: readonly string[],
  current: string | null,
  delta: 1 | -1,
): string | null {
  if (ids.length < 2) return null
  const at = current === null ? -1 : ids.indexOf(current)
  // Not in the ring: enter from the end the step comes from.
  if (at < 0) return (delta === 1 ? ids[0] : ids[ids.length - 1]) ?? null
  return ids[(at + delta + ids.length) % ids.length] ?? null
}

/**
 * The sessions a shortcut may land on.
 *
 * An archived session is off every ring and every numbered key, running or not:
 * the sidebar hides it in the dock, and a key that opened something invisible
 * would be a way out of the archive nobody asked for. Order is kept, because
 * Alt+N counts the rows the list shows.
 */
export function reachableSessions<T extends { readonly archived: boolean }>(
  sessions: readonly T[],
): readonly T[] {
  return sessions.filter((session) => !session.archived)
}

/**
 * The default terminal's key: where it lands, given what is on screen.
 *
 * Pressed on the default terminal it goes back, like a numbered key pressed on
 * its own session. With nothing behind, it stays: the caller creates the
 * terminal when none exists, so the key always has somewhere to go.
 *
 * As with the numbered keys, going back needs the destination to still be a
 * row: `rows` are the reachable ids, so the key is no way out of the archive.
 */
export function defaultTerminalTarget(
  current: string | null,
  previous: string | null,
  pinnedId: string,
  rows: readonly string[],
): string {
  const back = current === pinnedId && previous !== null && rows.includes(previous)
  return back ? previous : pinnedId
}

/** A row of the session list, as far as a shortcut is concerned. */
export interface Reachable {
  readonly id: string
  /** Its file failed to load, so there is nothing to open. */
  readonly broken: boolean
}

/**
 * Alt+N: the session the nth row opens.
 *
 * Pressing it on the session you are already in goes back where you came from
 * instead. Switching between two sessions is the common case, and it should not
 * cost a second shortcut.
 *
 * The bounce needs its destination to still be a row: archiving the session you
 * came from leaves it behind you, and handing it back would be a way out of the
 * archive that the key is not allowed to be.
 *
 * Null when the key has nowhere to go: past the end of the list, on a broken
 * row, or bouncing back with nothing reachable behind you.
 *
 * `pinned` is the default terminal's key while one exists. It has no row, so
 * no number opens it, but the bounce may return to it: the bounce follows
 * what was on screen.
 */
export function gotoTarget(
  rows: readonly Reachable[],
  index: number,
  current: string | null,
  previous: string | null,
  pinned: string | null = null,
): string | null {
  const target = rows[index]
  if (target === undefined) return null
  if (target.id === current) {
    if (previous === null) return null
    if (previous === pinned) return previous
    return rows.some((row) => row.id === previous) ? previous : null
  }
  return target.broken ? null : target.id
}
