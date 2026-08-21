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

/**
 * A column narrower than this on the map has an unreadable title. Rather than
 * shrink past it, the map stops scaling down and pans — the same answer the
 * canvas gives to a narrow window.
 */
export const MIN_OVERVIEW_COLUMN_PX = 110

/**
 * A row shorter than this cannot carry a line of text at map scale.
 *
 * The same answer as the rule above, on the other axis. A folded pane is a
 * fixed 30px bar on screen, so at map scale its row is a few pixels tall —
 * less than a card's own padding and border, which border-box cannot compress
 * below. Left alone the browser floors the row at its chrome, and it paints
 * over the row beneath it and out of the bottom of the map.
 *
 * The fix is not a minimum height: inflating the row would make the map lie
 * about a layout it exists to describe. The row keeps its true height and
 * gives up the text it has no room for, exactly as a column too narrow to
 * label stops shrinking rather than printing something unreadable.
 */
export const MIN_OVERVIEW_LABEL_PX = 28

/**
 * A row shorter than this cannot carry even one line of text.
 *
 * There are two different questions here, and asking only the first one is what
 * left the map unreadable. A stacked card needs room for three lines and its
 * padding, which is MIN_OVERVIEW_LABEL_PX. But a folded pane is a fixed 30px
 * bar and the map never scales past a half, so its row is at most 15px and can
 * never reach that — every folded pane came out anonymous, at every scale.
 *
 * A folded pane is one line on the canvas, so one line is what its row has to
 * carry here. That fits: the row keeps its true height and gives up only the
 * padding and the two lines under the name.
 */
export const MIN_OVERVIEW_ROW_PX = 12

/** Room for the full stacked card: a name with its command underneath. */
export function fitsALabel(cardHeight: number): boolean {
  return cardHeight >= MIN_OVERVIEW_LABEL_PX
}

/** Room for a single line: the pane's name, and nothing else. */
export function fitsAName(cardHeight: number): boolean {
  return cardHeight >= MIN_OVERVIEW_ROW_PX
}

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
  // The floor applies to the width term only: the height term still caps, so
  // the map never grows taller than the window.
  const fitWidth = room(viewport.width) / fullWidth
  const narrowest = Math.min(...layout.columns.map((c) => c.width))
  const floor = Math.min(MAX_OVERVIEW_SCALE, MIN_OVERVIEW_COLUMN_PX / narrowest)
  const scale = Math.min(
    MAX_OVERVIEW_SCALE,
    room(viewport.height) / fullHeight,
    Math.max(fitWidth, floor),
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

/** Width the map actually gets, next to the margins. */
const usableWidth = (viewportWidth: number): number =>
  Math.max(1, viewportWidth - OVERVIEW_MARGIN * 2)

/**
 * The fixed frame the strip slides under, in overlay coordinates.
 *
 * Its meaning is the marker's: the region of the canvas the viewport shows. It
 * simply stopped moving — the world moves instead.
 */
export interface Lens {
  readonly x: number
  readonly width: number
}

export function lensRect(viewport: Viewport, scale: number, mapWidth: number): Lens {
  const usable = usableWidth(viewport.width)
  const width = Math.min(viewport.width * scale, usable, mapWidth)
  return { x: OVERVIEW_MARGIN + (usable - width) / 2, width }
}

/**
 * The one rule tying the strip to the screen: map coordinate x is drawn at
 * `OVERVIEW_MARGIN + x - offset`. Everything below is that, rearranged.
 */
export function stripOffsetFor(scrollX: number, scale: number, lens: Lens): number {
  return OVERVIEW_MARGIN + scrollX * scale - lens.x
}

/**
 * Both ends must reach the lens or the first and last columns are unreachable,
 * so the strip overscrolls past the window on both sides. Offsets go negative.
 */
export function clampStripOffset(offset: number, mapWidth: number, lens: Lens): number {
  const atStart = OVERVIEW_MARGIN - lens.x
  const atEnd = OVERVIEW_MARGIN + mapWidth - lens.x - lens.width
  return Math.min(Math.max(offset, Math.min(atStart, atEnd)), Math.max(atStart, atEnd))
}

/** Where the canvas must scroll for its viewport to be what the lens framed. */
export function landingScrollX(
  offset: number,
  scale: number,
  canvasFullWidth: number,
  viewport: Viewport,
  lens: Lens,
): number {
  const wanted = (offset + lens.x - OVERVIEW_MARGIN) / scale
  return Math.min(Math.max(0, wanted), Math.max(0, canvasFullWidth - viewport.width))
}

/** Where the lens falls on the strip, in map coordinates. */
export function lensOnStrip(offset: number, lens: Lens): number {
  return offset + lens.x - OVERVIEW_MARGIN
}

/** Column centres along the strip, left to right. */
function columnCentres(cards: readonly OverviewCard[]): { id: string; centre: number }[] {
  const byColumn = new Map<string, OverviewCard>()
  for (const card of cards) if (!byColumn.has(card.columnId)) byColumn.set(card.columnId, card)
  return [...byColumn.values()]
    .map((card) => ({ id: card.columnId, centre: card.x + card.width / 2 }))
    .sort((a, b) => a.centre - b.centre)
}

/** The map coordinate the lens centre is pointing at. */
const lensCentreOn = (offset: number, lens: Lens): number =>
  offset + lens.x + lens.width / 2 - OVERVIEW_MARGIN

/** The column under the lens centre — the one the selection tracks. */
export function columnAtLensCenter(
  cards: readonly OverviewCard[],
  offset: number,
  lens: Lens,
): string | null {
  const centres = columnCentres(cards)
  if (centres.length === 0) return null
  const target = lensCentreOn(offset, lens)
  return centres.reduce((best, c) =>
    Math.abs(c.centre - target) < Math.abs(best.centre - target) ? c : best,
  ).id
}

/**
 * The offset that centres the next column one way or the other. Measured from
 * where the strip actually sits, so a half-way strip steps to its neighbour
 * rather than skipping one.
 */
export function columnSnapOffset(
  cards: readonly OverviewCard[],
  offset: number,
  dir: 'left' | 'right',
  lens: Lens,
): number {
  const centres = columnCentres(cards)
  if (centres.length === 0) return offset
  /*
   * Step from the column the lens is framing, not from the lens centre itself.
   * At a clamped end the centre trails the framed column, and a step measured
   * from it lands back on that same column: the press moves the strip a little
   * and the selection never advances.
   */
  const framed = columnAtLensCenter(cards, offset, lens)
  const at = Math.max(
    0,
    centres.findIndex((c) => c.id === framed),
  )
  const next = dir === 'right' ? Math.min(at + 1, centres.length - 1) : Math.max(at - 1, 0)
  return OVERVIEW_MARGIN + centres[next]!.centre - lens.x - lens.width / 2
}

/** The pane in this column whose middle sits closest to a remembered height. */
export function paneNearestY(
  cards: readonly OverviewCard[],
  columnId: string,
  y: number,
): string | null {
  const inColumn = cards.filter((c) => c.columnId === columnId)
  if (inColumn.length === 0) return null
  return inColumn.reduce((best, card) =>
    Math.abs(card.y + card.height / 2 - y) < Math.abs(best.y + best.height / 2 - y) ? card : best,
  ).paneId
}

/**
 * One selection step, by the canvas's own focus rules — a step on the map must
 * land where the same key would on the canvas. Returns the whole layout so
 * desiredY survives and ←→ stays reversible, exactly as on the canvas.
 */
export function moveSelection(layout: Layout, selectedId: string, dir: Direction): Layout {
  return focusDir({ ...layout, focusedPaneId: selectedId }, dir)
}
