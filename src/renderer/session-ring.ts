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
 * Null when the key has nowhere to go: past the end of the list, on a broken
 * row, or bouncing back with nothing behind you.
 */
export function gotoTarget(
  rows: readonly Reachable[],
  index: number,
  current: string | null,
  previous: string | null,
): string | null {
  const target = rows[index]
  if (target === undefined) return null
  if (target.id === current) return previous
  return target.broken ? null : target.id
}
