/**
 * The focused pane and the panes either side of it, as the title bar names them.
 *
 * A side is where a ←/→ focus move would land, so the bar previews the
 * keypress. The "drawn across" rule is focusDir's own, called rather than
 * copied, so the two cannot drift apart.
 */
import { findPane, focusDir, type Layout } from './layout-model'
import { isDefaultPaneTitle, stripName } from './pane-title'

export interface NeighbourSide {
  readonly paneId: string
  /** The layout title. A default one is resolved by barStrip from the pane's facts. */
  readonly title: string
  /** Columns past the neighbour's, further out on that side. */
  readonly beyond: number
  /** Some pane on that side, in the neighbour's column or further, wants a look. */
  readonly wants: boolean
}

export interface Neighbours {
  readonly left: NeighbourSide | null
  readonly right: NeighbourSide | null
}

/** A side as the bar draws it, its name already resolved. Null name: nothing to call it. */
export interface BarSide {
  readonly paneId: string
  readonly name: string | null
  readonly beyond: number
  readonly wants: boolean
}

export interface BarSides {
  readonly left: BarSide | null
  readonly right: BarSide | null
}

/** The whole strip. Null centre: the focused pane has nothing to call it. */
export interface BarStrip extends BarSides {
  readonly here: string | null
}

export function barNeighbours(
  layout: Layout,
  columnHeight: number,
  wants: (paneId: string) => boolean,
): Neighbours {
  return {
    left: sideOf(layout, 'left', columnHeight, wants),
    right: sideOf(layout, 'right', columnHeight, wants),
  }
}

function sideOf(
  layout: Layout,
  dir: 'left' | 'right',
  columnHeight: number,
  wants: (paneId: string) => boolean,
): NeighbourSide | null {
  const moved = focusDir(layout, dir, columnHeight)
  if (moved.focusedPaneId === layout.focusedPaneId) return null
  const target = findPane(layout, moved.focusedPaneId)
  if (target === null) return null

  const { columnIndex } = target
  const onSide =
    dir === 'left'
      ? layout.columns.slice(0, columnIndex + 1)
      : layout.columns.slice(columnIndex)
  return {
    paneId: target.pane.id,
    title: target.pane.title,
    beyond: onSide.length - 1,
    wants: onSide.some((column) => column.panes.some((pane) => wants(pane.id))),
  }
}

/** What is known about an untitled pane, as last asked. Null: not known. */
export interface PaneFacts {
  readonly command: string | null
  readonly cwd: string | null
}

/** The strip, every name resolved by stripName. */
export function barStrip(
  layout: Layout,
  columnHeight: number,
  wants: (paneId: string) => boolean,
  factsOf: (paneId: string) => PaneFacts,
  home: string,
): BarStrip {
  const nameOf = (paneId: string, title: string): string | null => {
    const { command, cwd } = factsOf(paneId)
    return stripName(title, command, cwd, home)
  }
  const raw = barNeighbours(layout, columnHeight, wants)
  const named = (side: NeighbourSide | null): BarSide | null =>
    side === null
      ? null
      : {
          paneId: side.paneId,
          name: nameOf(side.paneId, side.title),
          beyond: side.beyond,
          wants: side.wants,
        }
  const focused = findPane(layout, layout.focusedPaneId)?.pane ?? null
  return {
    here: focused === null ? null : nameOf(focused.id, focused.title),
    left: named(raw.left),
    right: named(raw.right),
  }
}

/** The strip's panes named by what they run or where they sit, since nobody titled them. Focused first. */
export function panesToAskCommands(layout: Layout, columnHeight: number): string[] {
  const { left, right } = barNeighbours(layout, columnHeight, () => false)
  const focused = findPane(layout, layout.focusedPaneId)?.pane ?? null
  return [
    focused === null ? null : { paneId: focused.id, title: focused.title },
    left,
    right,
  ]
    .filter((pane): pane is { paneId: string; title: string } => pane !== null)
    .filter((pane) => isDefaultPaneTitle(pane.title))
    .map((pane) => pane.paneId)
}
