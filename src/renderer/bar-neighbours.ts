/**
 * The panes either side of the focused one, as the title bar names them.
 *
 * A side is where a ←/→ focus move would land, so the bar previews the
 * keypress. The "drawn across" rule is focusDir's own, called rather than
 * copied, so the two cannot drift apart.
 */
import { findPane, focusDir, type Layout } from './layout-model'

export interface NeighbourSide {
  readonly paneId: string
  /** The layout title. A default one is resolved to a command by the caller. */
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

export interface BarTitle extends BarSides {
  readonly text: string
}

export const NO_SIDES: BarSides = { left: null, right: null }

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
