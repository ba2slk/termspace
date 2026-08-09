/**
 * The column/pane tree and the pure operations on it.
 *
 * No DOM, no xterm, no Electron. Every function returns a new Layout without
 * mutating its input. Most of this app's possible bugs live here, so getting
 * it right leaves the view with nothing to do but draw the result.
 */

export type Direction = 'left' | 'right' | 'up' | 'down'

export interface Pane {
  readonly id: string
  readonly title: string
  /** Share of the column's height; the column always totals 1. */
  readonly heightRatio: number
}

export interface Column {
  readonly id: string
  /** Pixels. The canvas is unbounded horizontally, so this is absolute. */
  readonly width: number
  readonly panes: readonly Pane[]
}

export interface Layout {
  readonly columns: readonly Column[]
  readonly focusedPaneId: string
  /** 0..1, the vertical position last set by ↑/↓. Decides where ←/→ lands. */
  readonly desiredY: number
}

export interface PaneSeed {
  readonly id: string
  readonly title: string
  readonly heightRatio?: number
}

export interface ColumnSeed {
  readonly id: string
  readonly width?: number
  readonly panes: readonly PaneSeed[]
}

export const MIN_COLUMN_WIDTH = 240
export const DEFAULT_COLUMN_WIDTH = 640
/** Three lines plus the body's vertical padding. */
export const MIN_PANE_HEIGHT = 62
/** Gap between panes. Mirrors the --gap token; owned here as part of the maths. */
export const PANE_GAP = 6
const RATIO_EPSILON = 1e-9

/** Column height minus the gaps — what the panes actually share. */
export function columnContentHeight(columnHeight: number, paneCount: number): number {
  return columnHeight - PANE_GAP * Math.max(0, paneCount - 1)
}

function normalize(ratios: readonly number[]): number[] {
  const sum = ratios.reduce((a, b) => a + b, 0)
  if (sum <= 0) return ratios.map(() => 1 / ratios.length)
  return ratios.map((r) => r / sum)
}

export function createLayout(seeds: readonly ColumnSeed[]): Layout {
  if (seeds.length === 0) throw new Error('a layout needs at least one column')

  const columns: Column[] = seeds.map((seed) => {
    if (seed.panes.length === 0) throw new Error(`column ${seed.id} has no panes`)
    // No ratios means even; partial ratios are normalised among themselves.
    const anyGiven = seed.panes.some((p) => p.heightRatio !== undefined)
    const raw = seed.panes.map((p) => (anyGiven ? (p.heightRatio ?? 1 / seed.panes.length) : 1))
    const ratios = normalize(raw)
    return {
      id: seed.id,
      width: Math.max(MIN_COLUMN_WIDTH, seed.width ?? DEFAULT_COLUMN_WIDTH),
      panes: seed.panes.map((p, i) => ({ id: p.id, title: p.title, heightRatio: ratios[i]! })),
    }
  })

  const first = columns[0]!.panes[0]!
  return { columns, focusedPaneId: first.id, desiredY: first.heightRatio / 2 }
}

export function allPanes(layout: Layout): readonly Pane[] {
  return layout.columns.flatMap((c) => c.panes)
}

export function findPane(
  layout: Layout,
  paneId: string,
): { column: Column; columnIndex: number; paneIndex: number; pane: Pane } | null {
  for (let ci = 0; ci < layout.columns.length; ci++) {
    const column = layout.columns[ci]!
    const pi = column.panes.findIndex((p) => p.id === paneId)
    if (pi >= 0) return { column, columnIndex: ci, paneIndex: pi, pane: column.panes[pi]! }
  }
  return null
}

/**
 * Structural invariants. Returns descriptions of any violation; empty is fine.
 * The ←→ round-trip invariant needs two states, so it lives in the focusDir tests.
 */
export function layoutViolations(layout: Layout): string[] {
  const problems: string[] = []

  if (layout.columns.length < 1) problems.push('no columns')

  for (const column of layout.columns) {
    if (column.panes.length === 0) {
      problems.push(`column ${column.id} has no panes`)
      continue
    }
    const sum = column.panes.reduce((a, p) => a + p.heightRatio, 0)
    if (Math.abs(sum - 1) > RATIO_EPSILON) {
      problems.push(`column ${column.id} height ratios total ${sum}, not 1`)
    }
  }

  const ids = [...layout.columns.map((c) => c.id), ...allPanes(layout).map((p) => p.id)]
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) problems.push(`duplicate id: ${id}`)
    seen.add(id)
  }

  if (findPane(layout, layout.focusedPaneId) === null) {
    problems.push(`focus points at a missing pane: ${layout.focusedPaneId}`)
  }

  return problems
}

// ── Operations ────────────────────────────────────────────────────

/** Can these ratios all clear the minimum height in this column? */
function fitsMinimum(ratios: readonly number[], columnHeight: number): boolean {
  const content = columnContentHeight(columnHeight, ratios.length)
  if (content <= 0) return false
  return ratios.every((r) => r * content >= MIN_PANE_HEIGHT)
}

/** Vertical centre of each pane, 0..1. Ratios total 1, so no pixels needed. */
function paneCenters(panes: readonly Pane[]): number[] {
  const out: number[] = []
  let acc = 0
  for (const p of panes) {
    out.push(acc + p.heightRatio / 2)
    acc += p.heightRatio
  }
  return out
}

/** The pane whose centre is nearest the target; ties go to the upper one. */
function nearestTo(panes: readonly Pane[], y: number): Pane {
  const centers = paneCenters(panes)
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < panes.length; i++) {
    const d = Math.abs(centers[i]! - y)
    if (d < bestDistance) {
      best = i
      bestDistance = d
    }
  }
  return panes[best]!
}

function withColumn(layout: Layout, columnIndex: number, column: Column): Column[] {
  const columns = [...layout.columns]
  columns[columnIndex] = column
  return columns
}

/**
 * Halve a pane and insert a new one above or below.
 *
 * Columns are vertical stacks, so only vertical splits belong here; growing
 * sideways means another column, which is addColumn.
 */
export function splitPane(
  layout: Layout,
  paneId: string,
  columnHeight: number,
  newPane: { id: string; title: string },
  side: 'up' | 'down' = 'down',
): Layout {
  const found = findPane(layout, paneId)
  if (found === null) return layout

  const { column, columnIndex, paneIndex, pane } = found
  const half = pane.heightRatio / 2
  const kept: Pane = { ...pane, heightRatio: half }
  const added: Pane = { id: newPane.id, title: newPane.title, heightRatio: half }
  const pair = side === 'down' ? [kept, added] : [added, kept]

  const panes: Pane[] = [
    ...column.panes.slice(0, paneIndex),
    ...pair,
    ...column.panes.slice(paneIndex + 1),
  ]

  // An extra gap shrinks every pane, so refuse if any would fall below the minimum.
  if (!fitsMinimum(panes.map((p) => p.heightRatio), columnHeight)) return layout

  const columns = withColumn(layout, columnIndex, { ...column, panes })
  const addedIndex = side === 'down' ? paneIndex + 1 : paneIndex
  return {
    columns,
    focusedPaneId: newPane.id,
    desiredY: paneCenters(panes)[addedIndex]!,
  }
}

/** Split downwards — the common case. */
export function splitDown(
  layout: Layout,
  paneId: string,
  columnHeight: number,
  newPane: { id: string; title: string },
): Layout {
  return splitPane(layout, paneId, columnHeight, newPane, 'down')
}

export function addColumn(
  layout: Layout,
  nearColumnId: string,
  spec: {
    id: string
    width?: number
    pane: { id: string; title: string }
    /** Which side of the reference column; defaults to right. */
    side?: 'left' | 'right'
  },
): Layout {
  const at = layout.columns.findIndex((c) => c.id === nearColumnId)
  if (at < 0) return layout

  const column: Column = {
    id: spec.id,
    width: Math.max(MIN_COLUMN_WIDTH, spec.width ?? DEFAULT_COLUMN_WIDTH),
    panes: [{ id: spec.pane.id, title: spec.pane.title, heightRatio: 1 }],
  }

  // Widths are absolute, so inserting a column only widens the canvas.
  const insertAt = spec.side === 'left' ? at : at + 1
  const columns = [
    ...layout.columns.slice(0, insertAt),
    column,
    ...layout.columns.slice(insertAt),
  ]
  return { columns, focusedPaneId: spec.pane.id, desiredY: 0.5 }
}

export function closePane(layout: Layout, paneId: string): Layout | null {
  const found = findPane(layout, paneId)
  if (found === null) return layout

  const { column, columnIndex, paneIndex } = found
  const wasFocused = layout.focusedPaneId === paneId

  // The last pane takes its column with it.
  if (column.panes.length === 1) {
    if (layout.columns.length === 1) return null // The session's last pane

    const columns = layout.columns.filter((_, i) => i !== columnIndex)
    if (!wasFocused) return { ...layout, columns }

    // Prefer the column to the right; the vacated index already points at it.
    const next = columns[columnIndex] ?? columns[columnIndex - 1]!
    return {
      columns,
      focusedPaneId: nearestTo(next.panes, layout.desiredY).id,
      desiredY: layout.desiredY,
    }
  }

  const remaining = column.panes.filter((p) => p.id !== paneId)
  const ratios = normalize(remaining.map((p) => p.heightRatio))
  const panes = remaining.map((p, i) => ({ ...p, heightRatio: ratios[i]! }))
  const columns = withColumn(layout, columnIndex, { ...column, panes })

  if (!wasFocused) {
    // Removing a sibling shifts the focused pane's centre, so desiredY must follow.
    const focusedIndex = panes.findIndex((p) => p.id === layout.focusedPaneId)
    if (focusedIndex < 0) return { ...layout, columns }
    return { columns, focusedPaneId: layout.focusedPaneId, desiredY: paneCenters(panes)[focusedIndex]! }
  }

  // Below first, then above; the vacated index is the one below.
  const next = panes[paneIndex] ?? panes[paneIndex - 1]!
  return { columns, focusedPaneId: next.id, desiredY: paneCenters(panes)[panes.indexOf(next)]! }
}

/**
 * Widths are absolute, so a column has no neighbour to push back against the
 * way stacked panes do — both bounds have to be applied here. Either bound only
 * stops the move, exactly as the minimum does: a column already past maxWidth
 * (a narrow window, a hand-written session) holds its width rather than being
 * pulled down to it, so widening the window brings it back whole.
 */
export function resizeColumn(
  layout: Layout,
  columnId: string,
  dx: number,
  maxWidth: number,
): Layout {
  const at = layout.columns.findIndex((c) => c.id === columnId)
  if (at < 0) return layout

  const column = layout.columns[at]!
  const ceiling = Math.max(maxWidth, column.width)
  const width = Math.max(MIN_COLUMN_WIDTH, Math.min(ceiling, column.width + dx))
  if (width === column.width) return layout

  return { ...layout, columns: withColumn(layout, at, { ...column, width }) }
}

/**
 * dy is what the pane gains, not which way a seam moves — the same reading as
 * dx in resizeColumn, where a column widens wherever it sits. The seam that
 * gives way is normally the one below; the last pane in a column has none, so
 * it takes from the one above and Alt+I stays "taller" everywhere.
 */
export function resizePane(
  layout: Layout,
  paneId: string,
  dy: number,
  columnHeight: number,
): Layout {
  const found = findPane(layout, paneId)
  if (found === null) return layout

  const { column, columnIndex, paneIndex, pane } = found
  const partnerIndex = column.panes[paneIndex + 1] !== undefined ? paneIndex + 1 : paneIndex - 1
  const partner = column.panes[partnerIndex]
  if (partner === undefined) return layout // Alone in its column

  const content = columnContentHeight(columnHeight, column.panes.length)
  if (content <= 0) return layout

  const minRatio = MIN_PANE_HEIGHT / content
  const pair = pane.heightRatio + partner.heightRatio
  // Nothing to adjust if the pair can't hold two minimums.
  if (pair < minRatio * 2) return layout

  const wanted = pane.heightRatio + dy / content
  const clamped = Math.min(Math.max(wanted, minRatio), pair - minRatio)
  if (clamped === pane.heightRatio) return layout

  const panes = [...column.panes]
  panes[paneIndex] = { ...pane, heightRatio: clamped }
  panes[partnerIndex] = { ...partner, heightRatio: pair - clamped }

  return { ...layout, columns: withColumn(layout, columnIndex, { ...column, panes }) }
}

/**
 * Move the focused pane. Vertically it swaps identities with its neighbour
 * while the size slots stay put — sizes never change, so the move is always
 * legal. Horizontally the pane leaves its column and joins the neighbour at
 * the slot nearest desiredY; past the edge it breaks out into a new column,
 * which is why the caller must supply an id for one. Unchanged layout back
 * means the move was refused.
 */
export function movePane(
  layout: Layout,
  dir: Direction,
  columnHeight: number,
  newColumnId: string,
): Layout {
  const found = findPane(layout, layout.focusedPaneId)
  if (found === null) return layout
  const { column, columnIndex, paneIndex, pane } = found

  if (dir === 'up' || dir === 'down') {
    const otherIndex = paneIndex + (dir === 'down' ? 1 : -1)
    const other = column.panes[otherIndex]
    if (other === undefined) return layout

    const panes = [...column.panes]
    panes[paneIndex] = { ...other, heightRatio: pane.heightRatio }
    panes[otherIndex] = { ...pane, heightRatio: other.heightRatio }
    return {
      columns: withColumn(layout, columnIndex, { ...column, panes }),
      focusedPaneId: pane.id,
      desiredY: paneCenters(panes)[otherIndex]!,
    }
  }

  /*
   * A pane leaves its column before it enters another.
   *
   * While it still has siblings, the move only breaks it out into a column of
   * its own; the press after that is what joins the neighbour. Landing in
   * someone else's column in one press is the move that has to be undone by
   * hand, and this way the two directions cancel each other exactly.
   */
  if (column.panes.length > 1) {
    const created: Column = {
      id: newColumnId,
      width: column.width,
      panes: [{ ...pane, heightRatio: 1 }],
    }
    const shrunk = shedPane(column, pane.id)
    const columns = layout.columns.flatMap((c, i) => {
      if (i !== columnIndex) return [c]
      return dir === 'left' ? [created, shrunk] : [shrunk, created]
    })
    // The height it left from, not its new centre — that memory is what puts it
    // back beside where it was on the next press.
    return { columns, focusedPaneId: pane.id, desiredY: layout.desiredY }
  }

  const targetIndex = columnIndex + (dir === 'right' ? 1 : -1)
  const target = layout.columns[targetIndex]
  // Alone at the edge: there is nothing to step out of and nothing to join.
  if (target === undefined) return layout

  // Land relative to the nearest pane: above its centre goes before, else after.
  const nearest = nearestTo(target.panes, layout.desiredY)
  const nearestIndex = target.panes.indexOf(nearest)
  const centre = paneCenters(target.panes)[nearestIndex]!
  const insertAt = layout.desiredY < centre ? nearestIndex : nearestIndex + 1

  const share = 1 / (target.panes.length + 1)
  const scaled = target.panes.map((p) => ({ ...p, heightRatio: p.heightRatio * (1 - share) }))
  const joined: Pane[] = [
    ...scaled.slice(0, insertAt),
    { ...pane, heightRatio: share },
    ...scaled.slice(insertAt),
  ]
  if (!fitsMinimum(joined.map((p) => p.heightRatio), columnHeight)) return layout

  // The pane was the column's last, so the column goes with it.
  const columns = layout.columns.flatMap((c, i) => {
    if (i === targetIndex) return [{ ...target, panes: joined }]
    return i === columnIndex ? [] : [c]
  })
  return { columns, focusedPaneId: pane.id, desiredY: paneCenters(joined)[insertAt]! }
}

/** The column without that pane, remaining ratios renormalised. */
function shedPane(column: Column, paneId: string): Column {
  const remaining = column.panes.filter((p) => p.id !== paneId)
  const ratios = normalize(remaining.map((p) => p.heightRatio))
  return { ...column, panes: remaining.map((p, i) => ({ ...p, heightRatio: ratios[i]! })) }
}

export function focusDir(layout: Layout, dir: Direction): Layout {
  const found = findPane(layout, layout.focusedPaneId)
  if (found === null) return layout

  const { column, columnIndex, paneIndex } = found

  if (dir === 'up' || dir === 'down') {
    const next = column.panes[paneIndex + (dir === 'down' ? 1 : -1)]
    if (next === undefined) return layout
    // Only vertical movement updates desiredY; that memory is what makes ←→ return.
    return {
      ...layout,
      focusedPaneId: next.id,
      desiredY: paneCenters(column.panes)[column.panes.indexOf(next)]!,
    }
  }

  const neighbour = layout.columns[columnIndex + (dir === 'right' ? 1 : -1)]
  if (neighbour === undefined) return layout

  // Leave desiredY alone, or → then ← stops returning to where it started.
  return { ...layout, focusedPaneId: nearestTo(neighbour.panes, layout.desiredY).id }
}
