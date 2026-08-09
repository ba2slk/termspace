/**
 * Resize by dragging the gap between panels.
 *
 * Pointer capture keeps events coming when the cursor leaves the handle, and
 * cleans up more easily than a document-level mousemove.
 */
import { autoscrollStep, type AutoscrollViewport } from './edge-autoscroll'

export interface ResizeDragHooks {
  readonly onColumnDrag: (columnId: string, dx: number) => void
  readonly onPaneDrag: (paneId: string, dy: number) => void
  readonly onDragEnd: () => void
  /** The canvas viewport in window coordinates, for finding its right border. */
  readonly viewport: () => AutoscrollViewport
  /**
   * Widen the column and pull the canvas along by the same step. Returns false
   * once the column stops changing width, which is what stops the loop — the
   * canvas must not keep sliding after the width cap is reached.
   */
  readonly onColumnEdgePush: (columnId: string, step: number) => boolean
}

export function attachResizeDrag(root: HTMLElement, hooks: ResizeDragHooks): () => void {
  let active: { kind: 'column' | 'pane'; id: string; last: number } | null = null
  let edgeRaf: number | null = null

  function stopEdgePush(): void {
    if (edgeRaf === null) return
    cancelAnimationFrame(edgeRaf)
    edgeRaf = null
  }

  /*
   * The pointer stops at the edge of the screen, so a column whose handle is
   * already there cannot be widened by moving the mouse. Holding it in the zone
   * scrolls the canvas instead, by exactly the amount the column grows, which
   * keeps the handle under the pointer.
   */
  function edgePush(): void {
    edgeRaf = null
    if (active === null || active.kind !== 'column') return
    const step = autoscrollStep(active.last, hooks.viewport())
    if (step === 0) return
    if (!hooks.onColumnEdgePush(active.id, step)) return
    edgeRaf = requestAnimationFrame(edgePush)
  }

  /** Only from a move, never from the press: grabbing a handle at the border
   * should not start widening on its own. Pushing into the edge is the request. */
  function syncEdgePush(): void {
    if (active === null || active.kind !== 'column') {
      stopEdgePush()
      return
    }
    const inZone = autoscrollStep(active.last, hooks.viewport()) > 0
    if (inZone && edgeRaf === null) edgeRaf = requestAnimationFrame(edgePush)
    else if (!inZone) stopEdgePush()
  }

  function onPointerDown(event: PointerEvent): void {
    const handle = (event.target as HTMLElement).closest<HTMLElement>('.resize-handle')
    if (handle === null) return

    const kind = handle.classList.contains('resize-handle--column') ? 'column' : 'pane'
    const id = handle.dataset['targetId']
    if (id === undefined) return

    event.preventDefault()
    // Capture on the root, not the handle: the handle is replaced on the first
    // re-render, which would drop the capture mid-drag. Failure is non-fatal —
    // capture is a convenience, not a precondition.
    try {
      root.setPointerCapture(event.pointerId)
    } catch {
      // Pointer already released or not capturable — carry on.
    }
    active = { kind, id, last: kind === 'column' ? event.clientX : event.clientY }
    root.classList.add('canvas--dragging')
  }

  function onPointerMove(event: PointerEvent): void {
    if (active === null) return
    const current = active.kind === 'column' ? event.clientX : event.clientY
    const delta = current - active.last
    if (delta === 0) return
    active.last = current
    if (active.kind === 'column') {
      hooks.onColumnDrag(active.id, delta)
      syncEdgePush()
    } else hooks.onPaneDrag(active.id, delta)
  }

  function onPointerUp(event: PointerEvent): void {
    if (active === null) return
    stopEdgePush()
    active = null
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId)
    root.classList.remove('canvas--dragging')
    hooks.onDragEnd()
  }

  root.addEventListener('pointerdown', onPointerDown)
  root.addEventListener('pointermove', onPointerMove)
  root.addEventListener('pointerup', onPointerUp)
  root.addEventListener('pointercancel', onPointerUp)

  return () => {
    stopEdgePush()
    root.removeEventListener('pointerdown', onPointerDown)
    root.removeEventListener('pointermove', onPointerMove)
    root.removeEventListener('pointerup', onPointerUp)
    root.removeEventListener('pointercancel', onPointerUp)
  }
}
