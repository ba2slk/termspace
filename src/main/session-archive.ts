/**
 * The sessions the user put away, as a list of ids.
 *
 * Archiving hides a session from the shortcuts and the main list without
 * touching the user's file, so the flag has to live in an app-owned file.
 */

/** Anything unreadable means nothing is archived, which is the safe reading. */
export function parseArchive(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry === '' || out.includes(entry)) continue
    out.push(entry)
  }
  return out
}

export function withArchived(archived: readonly string[], id: string): string[] {
  return archived.includes(id) ? [...archived] : [...archived, id]
}

export function withoutArchived(archived: readonly string[], id: string): string[] {
  return archived.filter((entry) => entry !== id)
}

/** Recorded ids with no session file are ignored — a delete must not resurrect one. */
export function markArchived<T extends { id: string }>(
  items: readonly T[],
  archived: readonly string[],
): (T & { archived: boolean })[] {
  const set = new Set(archived)
  return items.map((item) => ({ ...item, archived: set.has(item.id) }))
}
