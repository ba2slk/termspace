/**
 * Geometry for the overview: the whole canvas scaled into one viewport. Pure.
 *
 * Cards keep the canvas's real proportions — spatial memory must survive the
 * zoom-out — so this is paneRects shrunk by one factor, never re-laid-out.
 */
import {
  CANVAS_BOTTOM,
  CANVAS_EDGE,
  canvasWidth,
  paneRects,
  type Rect,
  type Viewport,
} from './layout-geometry'
import { focusDir, type Direction, type Layout } from './layout-model'

/** Breathing room between the map and the viewport edges. */
const OVERVIEW_MARGIN = 48

/** A session smaller than the viewport must still read as a map, not a copy. */
export const MAX_OVERVIEW_SCALE = 0.5

export interface OverviewCard extends Rect {
  readonly paneId: string
  readonly columnId: string
}

export interface OverviewLayout {
  readonly scale: number
  /** Size of the scaled map, for centring it. */
  readonly width: number
  readonly height: number
  readonly cards: readonly OverviewCard[]
  /** Where the real viewport sits on the map right now. */
  readonly viewportRect: Rect
}

export function overviewLayout(layout: Layout, viewport: Viewport): OverviewLayout {
  const fullWidth = canvasWidth(layout)
  const fullHeight = viewport.height
  const room = (side: number): number => Math.max(1, side - OVERVIEW_MARGIN * 2)
  const scale = Math.min(
    MAX_OVERVIEW_SCALE,
    room(viewport.width) / fullWidth,
    room(viewport.height) / fullHeight,
  )

  // The deeper CANVAS_BOTTOM inset clears the scrollbar; the map has none, so
  // the extra depth would just read as a lopsided marker. Even the insets out.
  const cards = paneRects(layout, viewport.height + (CANVAS_BOTTOM - CANVAS_EDGE)).map((rect) => ({
    paneId: rect.paneId,
    columnId: rect.columnId,
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  }))

  const width = fullWidth * scale
  const height = fullHeight * scale
  const markerWidth = Math.min(viewport.width * scale, width)
  return {
    scale,
    width,
    height,
    cards,
    viewportRect: {
      x: Math.min(viewport.scrollX * scale, width - markerWidth),
      y: 0,
      width: markerWidth,
      height,
    },
  }
}

/**
 * One selection step, by the canvas's own focus rules — a step on the map must
 * land where the same key would on the canvas. Returns the whole layout so
 * desiredY survives and ←→ stays reversible, exactly as on the canvas.
 */
export function moveSelection(layout: Layout, selectedId: string, dir: Direction): Layout {
  return focusDir({ ...layout, focusedPaneId: selectedId }, dir)
}
