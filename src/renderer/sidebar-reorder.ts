/**
 * Turning a pointer position into the index a dragged row would land on.
 *
 * Indices are post-removal: the dragged row is taken out of the list first, so
 * the number is the one `moveTo` wants.
 */

export interface RowBox {
  readonly top: number
  readonly height: number
}

/** How far the pointer must travel before a press becomes a drag, not a click. */
export const REORDER_THRESHOLD = 5

export function dropIndexAt(
  pointerY: number,
  rows: readonly RowBox[],
  fromIndex: number,
): number {
  let index = 0
  for (let i = 0; i < rows.length; i++) {
    if (i === fromIndex) continue // The row being dragged is not a landmark.
    const row = rows[i]
    if (row === undefined) continue
    if (pointerY < row.top + row.height / 2) break
    index++
  }
  return index
}

/** Where a released drag would land: a slot in the list, or the archive. */
export type DropTarget = { readonly kind: 'index'; readonly index: number } | { readonly kind: 'archive' }

/**
 * The archive header sits under the list, so the pointer reaching it also reads
 * as "past every row" to `dropIndexAt`. The header wins: a drag that has gone
 * that far is aiming at it, not at the last slot. Anything at or below its top
 * edge counts, because nothing else lives down there.
 */
export function dropTargetAt(
  pointerY: number,
  rows: readonly RowBox[],
  fromIndex: number,
  header: RowBox | null,
): DropTarget {
  if (header !== null && pointerY >= header.top) return { kind: 'archive' }
  return { kind: 'index', index: dropIndexAt(pointerY, rows, fromIndex) }
}

/**
 * A row dragged out of the archive: above the dock's top edge is the session
 * list, and dropping there puts the session back. The dock is one zone, header
 * and rows alike — a drag that stays inside it is a drag that changed its mind.
 */
export function isRestoreDrop(pointerY: number, dock: RowBox | null): boolean {
  return dock !== null && pointerY < dock.top
}

/**
 * How far a row that is not being dragged has to move, in slots, for the list
 * to look as it will after the drop: rows between the origin and the target
 * step one slot toward the hole the dragged row left. Post-removal `dropIndex`,
 * like `dropIndexAt` returns.
 */
export function rowShift(index: number, fromIndex: number, dropIndex: number): -1 | 0 | 1 {
  if (index === fromIndex) return 0
  if (dropIndex > fromIndex && index > fromIndex && index <= dropIndex) return -1
  if (dropIndex < fromIndex && index >= dropIndex && index < fromIndex) return 1
  return 0
}
