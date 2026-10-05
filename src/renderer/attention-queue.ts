/**
 * The panes waiting to be looked at, oldest first, with what each one said.
 *
 * Whether a pane is waiting is decided elsewhere (the session's attention set).
 * This only keeps the order and the text, so the two can never disagree about
 * who is waiting: a row is dropped by asking that set, not by a second rule.
 */

/** One pane waiting to be looked at, with what it said. */
export interface QueuedNotification {
  readonly paneId: string
  /** Empty for an OSC 9, which carries a body alone. */
  readonly title: string
  readonly body: string
  /** Epoch ms of the latest notification from this pane. */
  readonly at: number
}

/** Append, or refresh in place: a pane that asks twice keeps its turn. */
export function upsert(
  queue: readonly QueuedNotification[],
  entry: QueuedNotification,
): readonly QueuedNotification[] {
  const at = queue.findIndex((queued) => queued.paneId === entry.paneId)
  if (at < 0) return [...queue, entry]
  return queue.map((queued, index) => (index === at ? entry : queued))
}

/** Drop the panes that are no longer waiting. Returns the same array when nothing left. */
export function prune(
  queue: readonly QueuedNotification[],
  stillWaiting: (paneId: string) => boolean,
): readonly QueuedNotification[] {
  const kept = queue.filter((queued) => stillWaiting(queued.paneId))
  // Same reference when nothing went, so a caller can skip the redraw.
  return kept.length === queue.length ? queue : kept
}
