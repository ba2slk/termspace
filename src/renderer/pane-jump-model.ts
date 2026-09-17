/**
 * Ranking for the pane jump: which panes a few typed letters mean, best first.
 * Pure, so the rules are pinned by unit tests rather than by eye.
 */

/** A pane the jump can land on. */
export interface JumpEntry {
  readonly id: string
  /** The pane's layout title; DEFAULT_PANE_TITLE when unnamed. */
  readonly name: string
  /** One-based, left to right. */
  readonly column: number
  readonly command: string
  readonly windowTitle: string
  readonly focused: boolean
  readonly wants: boolean
}

/** Where a query landed in one field, and how well. */
export interface FieldMatch {
  readonly score: number
  /** Indices into the field's text, ascending. */
  readonly positions: readonly number[]
}

/** One ranked pane, with the match in each field it hit. */
export interface JumpResult {
  readonly entry: JumpEntry
  readonly name: FieldMatch | null
  readonly command: FieldMatch | null
  readonly windowTitle: FieldMatch | null
}

const WORD_START = 8
/** Above WORD_START: a run of letters typed as they appear beats scattered initials. */
const ADJACENT = 12
const MAX_GAP_COST = 4
const MAX_LATE_COST = 5
/** Name over command over window title: what the user called it beats what it runs. */
const NAME_BONUS = 4
const COMMAND_BONUS = 2

const SEPARATOR = /[\s:\-_./]/

function isWordStart(text: string, index: number): boolean {
  return index === 0 || SEPARATOR.test(text[index - 1] as string)
}

/** The best reading of the query inside one field, or null when it does not fit. */
export function matchField(query: string, text: string): FieldMatch | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (q === '') return null
  let best: FieldMatch | null = null
  // Try every place the first letter occurs; the first hit is often mid-word.
  for (
    let start = t.indexOf(q[0] as string);
    start !== -1;
    start = t.indexOf(q[0] as string, start + 1)
  ) {
    const positions = [start]
    let at = start
    for (let i = 1; i < q.length && at !== -1; i++) {
      at = t.indexOf(q[i] as string, at + 1)
      if (at !== -1) positions.push(at)
    }
    if (positions.length < q.length) break // later starts only have less text left
    let score = -Math.min(MAX_LATE_COST, start)
    positions.forEach((position, i) => {
      if (isWordStart(t, position)) score += WORD_START
      if (i === 0) return
      const gap = position - (positions[i - 1] as number) - 1
      score += gap === 0 ? ADJACENT : -Math.min(MAX_GAP_COST, gap)
    })
    if (best === null || score > best.score) best = { score, positions }
  }
  return best
}

/**
 * The panes a query means, best first. An empty query is not a filter: it lists
 * everything as given, so opening the jump shows the panes before any typing.
 */
export function rankEntries(query: string, entries: readonly JumpEntry[]): JumpResult[] {
  const q = query.replace(/\s+/g, '')
  if (q === '') {
    return entries.map((entry) => ({ entry, name: null, command: null, windowTitle: null }))
  }
  const scored: { result: JumpResult; score: number; order: number }[] = []
  entries.forEach((entry, order) => {
    const name = matchField(q, entry.name)
    const command = matchField(q, entry.command)
    const windowTitle = matchField(q, entry.windowTitle)
    if (name === null && command === null && windowTitle === null) return
    const score = Math.max(
      name === null ? -Infinity : name.score + NAME_BONUS,
      command === null ? -Infinity : command.score + COMMAND_BONUS,
      windowTitle === null ? -Infinity : windowTitle.score,
    )
    scored.push({ result: { entry, name, command, windowTitle }, score, order })
  })
  // A tie keeps the order given, so the list does not shuffle as letters arrive.
  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  return scored.map((item) => item.result)
}
