/**
 * Stepping through the open sessions, one key press at a time.
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
