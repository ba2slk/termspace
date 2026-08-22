/**
 * The user's order for the session list, as a list of ids.
 *
 * Sessions have no creation time of their own, and a rename moves the file, so
 * neither the alphabet nor the filesystem can carry an order the user chose.
 */

/** Anything unreadable is no order at all, which degrades to creation time. */
export function parseOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry === '' || out.includes(entry)) continue
    out.push(entry)
  }
  return out
}

/**
 * Recorded ids hold their position; the rest follow by creation time. Ids with
 * no file drop out — a deleted session must not hold a gap.
 */
export function applyOrder<T extends { id: string; createdMs: number }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const known: T[] = []
  for (const id of order) {
    const item = byId.get(id)
    if (item === undefined) continue
    known.push(item)
    byId.delete(id)
  }
  // Same instant, two files: id keeps the order stable between listings.
  const rest = [...byId.values()].sort(
    (a, b) => a.createdMs - b.createdMs || a.id.localeCompare(b.id),
  )
  return [...known, ...rest]
}

export function moveTo(order: readonly string[], id: string, toIndex: number): string[] {
  const from = order.indexOf(id)
  if (from === -1) return [...order]
  const rest = order.filter((entry) => entry !== id)
  const at = Math.min(Math.max(toIndex, 0), rest.length)
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

/**
 * Move within the ids the user can see. The sidebar counts slots over the rows
 * it draws, so a hidden id earlier in the order would otherwise shift the
 * landing slot by one. Hidden ids keep their absolute places; the rest close up
 * around the move.
 */
export function moveToVisible(
  order: readonly string[],
  hidden: ReadonlySet<string>,
  id: string,
  toIndex: number,
): string[] {
  // A hidden row has no slot of its own to be dropped into.
  if (hidden.has(id)) return [...order]
  const visible = order.filter((entry) => !hidden.has(entry))
  const moved = moveTo(visible, id, toIndex)
  let next = 0
  return order.map((entry) => (hidden.has(entry) ? entry : (moved[next++] as string)))
}

/** A rename moves the file, so the id changes while the position must not. */
export function renameInOrder(
  order: readonly string[],
  oldId: string,
  newId: string,
): string[] {
  const at = order.indexOf(oldId)
  if (at === -1) return [...order]
  const next = order.map((entry, i) => (i === at ? newId : entry))
  // The new id may already sit elsewhere; the moved one wins its old place.
  return next.filter((entry, i) => i === at || entry !== newId)
}
