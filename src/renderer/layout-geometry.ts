/**
 * Layout to pixel rectangles. Pure; never reads the DOM.
 *
 * Both drawing and visibility need this maths, and keeping it out of either
 * means neither has to recover positions from the DOM.
 *
 * Canvas coordinates: x = 0 is the canvas's left edge, independent of scrollX.
 */
import { columnContentHeight, PANE_GAP, type Layout } from './layout-model'

/** Canvas edge inset; mirrors the --edge token. */
export const CANVAS_EDGE = 6

/**
 * Deeper along the bottom: the scrollbar runs there and would otherwise sit on
 * the pane outline. Leaves clearance above and below the bar.
 */
export const CANVAS_BOTTOM = 12

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface PaneRect extends Rect {
  readonly paneId: string
  readonly columnId: string
}

export interface Viewport {
  readonly width: number
  readonly height: number
  readonly scrollX: number
}

export function canvasWidth(layout: Layout): number {
  const columns = layout.columns.reduce((a, c) => a + c.width, 0)
  return CANVAS_EDGE * 2 + columns + PANE_GAP * Math.max(0, layout.columns.length - 1)
}

/** Column height: canvas height minus the top and bottom insets. */
export function columnHeightIn(canvasHeight: number): number {
  return canvasHeight - CANVAS_EDGE - CANVAS_BOTTOM
}

/**
 * The widest a column may be grown to: one that exactly fills the viewport.
 * Past this the column itself no longer fits on screen, so widening only
 * lengthens the scroll range.
 */
export function maxColumnWidth(viewportWidth: number): number {
  return viewportWidth - CANVAS_EDGE * 2
}

export function paneRects(layout: Layout, canvasHeight: number): PaneRect[] {
  const columnHeight = columnHeightIn(canvasHeight)
  const rects: PaneRect[] = []
  let x = CANVAS_EDGE

  for (const column of layout.columns) {
    const content = columnContentHeight(columnHeight, column.panes.length)
    let y = CANVAS_EDGE
    for (const pane of column.panes) {
      const height = content * pane.heightRatio
      rects.push({ paneId: pane.id, columnId: column.id, x, y, width: column.width, height })
      y += height + PANE_GAP
    }
    x += column.width + PANE_GAP
  }
  return rects
}

export function maxScrollX(layout: Layout, viewportWidth: number): number {
  return Math.max(0, canvasWidth(layout) - viewportWidth)
}

/**
 * scrollX that brings the focused pane fully into view, or null if it already
 * is — nudging on every move accumulates into visible jitter.
 */
export function scrollToReveal(
  rects: readonly PaneRect[],
  paneId: string,
  viewport: Viewport,
  layout: Layout,
): number | null {
  const rect = rects.find((r) => r.paneId === paneId)
  if (rect === undefined) return null

  const left = rect.x - CANVAS_EDGE
  const right = rect.x + rect.width + CANVAS_EDGE
  const viewLeft = viewport.scrollX
  const viewRight = viewport.scrollX + viewport.width

  let target: number
  if (right - left > viewport.width) {
    target = left // Wider than the viewport: align its left edge.
  } else if (left < viewLeft) {
    target = left
  } else if (right > viewRight) {
    target = right - viewport.width
  } else {
    return null // Already fully visible.
  }

  const clamped = Math.max(0, Math.min(target, maxScrollX(layout, viewport.width)))
  return clamped === viewport.scrollX ? null : clamped
}

/**
 * Panes overlapping the active region: the viewport widened by one screen each
 * way, so renderers are attached before they scroll into view.
 */
/**
 * A CSS length that lands on a whole device pixel.
 *
 * The track slides by a transform, and a translation that stops between device
 * pixels is resampled by the compositor: at a 1.67× or 1.5× scale most integer
 * CSS offsets do, so thin strokes shimmer while the canvas glides. Rounding in
 * device pixels keeps every frame crisp; at 1× and 2× it is plain rounding.
 */
export function snapToDevicePixels(cssPx: number, devicePixelRatio: number): number {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1
  return Math.round(cssPx * dpr) / dpr
}

export function visiblePaneIds(rects: readonly PaneRect[], viewport: Viewport): string[] {
  const from = viewport.scrollX - viewport.width
  const to = viewport.scrollX + viewport.width * 2
  return rects.filter((r) => r.x < to && r.x + r.width > from).map((r) => r.paneId)
}
