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
