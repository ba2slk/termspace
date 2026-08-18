/**
 * Decides which panes get a WebGL context and whose output is deferred. Pure.
 *
 * Chromium caps active WebGL contexts per page and force-releases the oldest
 * past that, which shows up as flicker or black panes. Twenty panes is normal
 * usage here, so the budget is managed explicitly with headroom to spare.
 *
 * attach/detach and freeze/thaw are separate axes: attach is capped, freeze
 * follows visibility only. A visible pane over the cap simply falls back to
 * the DOM renderer with its output intact.
 */

/** Below Chromium's own limit, so the browser never force-releases one. */
export const MAX_WEBGL_CONTEXTS = 12

export interface BudgetState {
  /** Every paneId — panes never yet seen also need freezing. */
  readonly allPaneIds: readonly string[]
  /** paneIds overlapping the active region. */
  readonly visible: readonly string[]
  /** Currently frozen. */
  readonly frozen: readonly string[]
  /** Currently holding a WebGL context. */
  readonly attached: readonly string[]
  readonly focusedPaneId: string
  /** paneId to last-seen tick; any monotonic counter works. */
  readonly lastSeen: ReadonlyMap<string, number>
  readonly limit?: number
  /** A session that is not on screen. Defaults to true. */
  readonly active?: boolean
}

export interface BudgetDecision {
  readonly attach: readonly string[]
  readonly detach: readonly string[]
  readonly thaw: readonly string[]
  readonly freeze: readonly string[]
}

function difference(a: readonly string[], b: readonly string[]): string[] {
  const exclude = new Set(b)
  return a.filter((id) => !exclude.has(id))
}

export function decideBudget(state: BudgetState): BudgetDecision {
  const limit = state.limit ?? MAX_WEBGL_CONTEXTS

  // Focus first, then recency, then id — a stable order avoids per-frame churn.
  const ranked = [...state.visible].sort((a, b) => {
    if (a === state.focusedPaneId) return -1
    if (b === state.focusedPaneId) return 1
    const seen = (state.lastSeen.get(b) ?? -Infinity) - (state.lastSeen.get(a) ?? -Infinity)
    return seen !== 0 ? seen : a.localeCompare(b)
  })

  /*
   * A session off screen asks for nothing and gives up nothing.
   *
   * The cap belongs to the page rather than to one session, but handing every
   * context back on the way out made each switch rebuild them all — tens of
   * milliseconds per pane, right after the new session had already appeared.
   * A hidden session holds what it holds; the arriving one takes those slots
   * only when it actually runs short (see session-runtime's page ledger).
   */
  const wanted = ranked.slice(0, limit)

  /*
   * A renderer on a pane that scrolled out of view stays put while there is
   * room. Swapping renderers shows: the DOM and WebGL cell widths differ, so
   * the pane reflows and redraws when it comes back — a jolt on every scroll
   * that crossed it. Idle contexts go only when a visible pane needs the slot,
   * least recently seen first.
   */
  const inView = new Set(state.visible)
  const idle = state.attached
    .filter((id) => !inView.has(id))
    .sort((a, b) => {
      const seen = (state.lastSeen.get(b) ?? -Infinity) - (state.lastSeen.get(a) ?? -Infinity)
      return seen !== 0 ? seen : a.localeCompare(b)
    })
  const keep =
    state.active === false
      ? state.attached
      : wanted.concat(idle.slice(0, Math.max(0, limit - wanted.length)))

  // The focused pane never freezes: it is the one taking keystrokes, and a
  // frozen pane queues its output out of sight of both screen and clipboard.
  const awake = new Set([...state.visible, state.focusedPaneId])

  return {
    attach: difference(keep, state.attached),
    detach: difference(state.attached, keep),
    // Thaw anything that should be awake.
    thaw: state.frozen.filter((id) => awake.has(id)),
    // Derived from all panes, not just recently visible ones, so never-seen
    // panes don't stay awake forever.
    freeze: difference(
      state.allPaneIds.filter((id) => !awake.has(id)),
      state.frozen,
    ),
  }
}
