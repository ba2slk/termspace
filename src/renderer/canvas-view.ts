/**
 * Renders Layout into the DOM and slides the viewport horizontally.
 *
 * Scrolling is done with transform rather than browser overflow: rapid input
 * has to cancel the animation in flight and retarget, which CSS
 * scroll-behavior gives no control over.
 */
import {
  CANVAS_BOTTOM,
  CANVAS_EDGE,
  canvasWidth,
  columnHeightIn,
  maxScrollX,
  paneRects,
  scrollToReveal,
  snapToDevicePixels,
  type PaneRect,
  type Rect,
  type Viewport,
} from './layout-geometry'
import { PANE_GAP, type Layout, type Pane } from './layout-model'
import { isDefaultPaneTitle } from './pane-title'
import { createPaneView, type PaneView } from './pane-view'
import { indicatorMetrics, scrollForThumbDelta } from './scroll-indicator'
import { FRAME_MS, glideFactor, nextBurst, wheelPixels } from './wheel-physics'

// Mirrors the `--dur` token; change both together.
const SCROLL_DURATION_MS = 180
// Mirrors the `--hit` token; change both together.
const HANDLE_HIT = 12
/** Pointer travel a click may still have, in pixels. Beyond it, it is a drag. */
const CLICK_SLOP = 4

export interface CanvasHooks {
  readonly onPaneMouseDown: (paneId: string) => void
  /**
   * A press and release on the same pane with no drag between them.
   *
   * Separate from the mousedown hook because dragging out a text selection
   * starts the same way, and moving the canvas mid-drag would tear it.
   */
  readonly onPaneClick?: (paneId: string) => void
  /** Called on every scroll change; the renderer budget hangs off this. */
  readonly onScroll?: () => void
  /**
   * Wheel multiplier. Passed as a function since the setting changes at runtime.
   */
  readonly scrollBoost?: () => number
  /** Whether Shift+wheel slides the canvas. Off by setting, not by code. */
  readonly shiftPans?: () => boolean
}

export interface CanvasView {
  /** Element holding the canvas coordinate space; resize handles attach here. */
  readonly root: HTMLElement
  render(layout: Layout): void
  /** Scrolls only when needed; does nothing if the pane is already visible. */
  scrollToPane(paneId: string, layout: Layout): void
  /**
   * Clamp scroll back into range after a width change, without moving the view.
   */
  clampScroll(layout: Layout): void
  /**
   * Slide the canvas by a wheel delta, with the same acceleration and glide as
   * scrolling over the canvas itself. Lets other surfaces drive the viewport.
   */
  panBy(delta: number, deltaMode: number): void
  /**
   * Slide by exactly this many pixels, with no acceleration and no glide, for a
   * gesture that already knows the distance it wants.
   */
  scrollByExact(dx: number): void
  /** Where the viewport sits in the canvas, for anything drawing an indicator. */
  scrollState(): {
    readonly offset: number
    readonly viewport: number
    readonly total: number
    /** Canvas's left edge in window coordinates, so an indicator can line up. */
    readonly left: number
  }
  /**
   * Blow one pane up over the visible canvas, or restore the layout with null.
   *
   * View state only: the layout keeps the rects it always had, so what a save
   * writes and which panes the renderer budget sees are untouched.
   */
  setZoom(paneId: string | null): void
  /**
   * What a folded pane's bar shows besides its title. Kept here rather than
   * asked for on every render: it comes over IPC, and the layout redraws far
   * more often than a shell changes what it is running.
   */
  setFoldDetail(paneId: string, detail: { command: string; wants: boolean }): void
  getViewport(): Viewport
  getRects(): readonly PaneRect[]
  paneBody(paneId: string): HTMLElement | null
  setPaneFrozen(paneId: string, frozen: boolean): void
  destroy(): void
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3

export function createCanvasView(host: HTMLElement, hooks: CanvasHooks): CanvasView {
  const track = document.createElement('div')
  track.className = 'canvas-track'

  const handles = document.createElement('div')
  handles.className = 'resize-handles'
  track.append(handles)


  /*
   * Side gutters.
   *
   * The canvas's own inset scrolls away with the content, so panes would butt
   * against the sidebar on one side and the window frame on the other as soon
   * as it moves. Fixed bands over the scrolling content keep both gaps
   * identical at every scroll position.
   */
  const gutter = document.createElement('div')
  gutter.className = 'canvas-gutter'
  const gutterRight = document.createElement('div')
  gutterRight.className = 'canvas-gutter canvas-gutter--right'

  /*
   * The canvas scrollbar, at the bottom where a scrollbar belongs.
   *
   * Shown whenever the canvas overflows rather than only while scrolling: it is
   * the only thing saying more exists off screen, and a hint that hides says
   * nothing. Brightens while the title bar — which scrolls it — is hovered.
   */
  const indicator = document.createElement('div')
  indicator.className = 'scroll-indicator'

  host.append(track, gutter, gutterRight, indicator)

  const views = new Map<string, PaneView>()
  const foldDetails = new Map<string, { command: string; wants: boolean }>()
  let rects: PaneRect[] = []
  let currentLayout: Layout | null = null
  let scrollX = 0
  let animation: number | null = null
  let zoomedPaneId: string | null = null

  const canvasWidthOf = (): number => (currentLayout === null ? 0 : canvasWidth(currentLayout))
  /** Wheel multiplier, from the scroll acceleration setting. */
  const baseBoostOf = (): number => Math.max(1, hooks.scrollBoost?.() ?? 1)

  /**
   * Where the visible area starts, in track coordinates.
   *
   * The transform below snaps, so anything laid over the viewport has to read
   * the same snapped value: against the raw scroll the box lands up to a device
   * pixel away from the screen, and a wheel glide leaves the scroll fractional
   * often enough for that to be the normal case.
   */
  const trackLeft = (): number => snapToDevicePixels(scrollX, window.devicePixelRatio)

  /**
   * The zoomed pane's box, in track coordinates.
   *
   * The insets are the ones every pane already keeps against the canvas edge.
   */
  const zoomRect = (): Rect => ({
    x: trackLeft() + CANVAS_EDGE,
    y: CANVAS_EDGE,
    width: host.clientWidth - CANVAS_EDGE * 2,
    height: host.clientHeight - CANVAS_EDGE - CANVAS_BOTTOM,
  })

  /*
   * Behind the zoomed pane, over everything else.
   *
   * Boxes are rounded to whole CSS pixels, so the zoomed pane's edge can still
   * miss the snapped viewport edge by a fraction, and that sliver showed the
   * live pane underneath. Behind a normal pane the same hairline shows canvas
   * background, which is exactly what this paints.
   */
  const scrim = document.createElement('div')
  scrim.className = 'zoom-scrim'

  /** Lay the zoom box, and the scrim under it, over the visible area. */
  function applyZoom(): void {
    if (zoomedPaneId === null) return
    scrim.style.left = `${String(trackLeft())}px`
    scrim.style.width = `${String(host.clientWidth)}px`
    scrim.style.height = `${String(host.clientHeight)}px`
    views.get(zoomedPaneId)?.setRect(zoomRect())
  }

  const paneIdAt = (event: MouseEvent): string | undefined =>
    (event.target as HTMLElement).closest<HTMLElement>('.pane')?.dataset['paneId']

  let press: { readonly paneId: string; readonly x: number; readonly y: number } | null = null

  host.addEventListener('mousedown', (event) => {
    const paneId = paneIdAt(event)
    if (paneId === undefined) {
      press = null
      return
    }
    press = { paneId, x: event.clientX, y: event.clientY }
    hooks.onPaneMouseDown(paneId)
  })

  host.addEventListener('mouseup', (event) => {
    const start = press
    press = null
    if (start === null || paneIdAt(event) !== start.paneId) return
    const moved = Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y)
    if (moved <= CLICK_SLOP) hooks.onPaneClick?.(start.paneId)
  })

  function syncIndicator(): void {
    const metrics = indicatorMetrics(scrollX, canvasWidthOf(), host.clientWidth)
    if (metrics === null) {
      indicator.hidden = true
      return
    }
    indicator.hidden = false
    indicator.style.width = `${String(metrics.thumb)}px`
    indicator.style.left = `${String(CANVAS_EDGE + metrics.offset)}px`
  }

  function applyScroll(value: number): void {
    scrollX = value
    track.style.transform = `translateX(${-snapToDevicePixels(value, window.devicePixelRatio)}px)`
    // The track moves under it, so the zoom box has to move with the scroll.
    applyZoom()
    syncIndicator()
    hooks.onScroll?.()
  }

  function cancelAnimation(): void {
    if (animation === null) return
    cancelAnimationFrame(animation)
    animation = null
  }

  function animateTo(target: number): void {
    cancelAnimation()
    const from = scrollX
    const distance = target - from
    if (distance === 0) return
    const start = performance.now()

    const step = (now: number): void => {
      // Fixed duration regardless of distance, so long moves don't drag.
      const t = Math.min(1, (now - start) / SCROLL_DURATION_MS)
      applyScroll(from + distance * easeOutCubic(t))
      animation = t < 1 ? requestAnimationFrame(step) : null
    }
    animation = requestAnimationFrame(step)
  }

  /**
   * Wheel scrolling: hold a target and pull toward it each frame.
   *
   * The canvas is several viewports wide, so raw wheel deltas would take dozens
   * of notches to cross it — a ratio that suits documents, not this. Three
   * things stack: a base multiplier, acceleration while rolling continuously,
   * and inertia toward the target.
   *
   * The glide step is corrected for the frame interval, or the same setting
   * would feel twice as fast at 120Hz.
   *
   * The keyboard animation shares no target with this; new input always cancels
   * whatever is in flight.
   */
  let wheelTarget = 0
  let wheelRaf: number | null = null
  let lastWheelAt = 0
  let lastFrameAt = 0
  let burst = 1

  function stopWheelGlide(): void {
    if (wheelRaf === null) return
    cancelAnimationFrame(wheelRaf)
    wheelRaf = null
    lastFrameAt = 0
  }

  function glide(now: number): void {
    const remaining = wheelTarget - scrollX
    if (Math.abs(remaining) < 0.5) {
      applyScroll(wheelTarget)
      wheelRaf = null
      lastFrameAt = 0
      return
    }
    // Baseline is one 60fps frame, corrected for the real interval.
    const dt = lastFrameAt === 0 ? FRAME_MS : Math.min(64, now - lastFrameAt)
    lastFrameAt = now

    applyScroll(scrollX + remaining * glideFactor(dt))
    wheelRaf = requestAnimationFrame(glide)
  }

  function panBy(raw: number, deltaMode: number): void {
    // A zoomed pane covers the canvas; panning it would only slide it away.
    if (currentLayout === null || raw === 0 || zoomedPaneId !== null) return
    const delta = wheelPixels(raw, deltaMode)

    const now = performance.now()
    burst = nextBurst(burst, now - lastWheelAt)
    lastWheelAt = now

    cancelAnimation() // let go of any keyboard move in flight
    const limit = maxScrollX(currentLayout, host.clientWidth)
    // Accumulate from the pending target so repeated input adds up.
    const from = wheelRaf === null ? scrollX : wheelTarget
    wheelTarget = Math.max(0, Math.min(from + delta * baseBoostOf() * burst, limit))
    if (wheelRaf === null) wheelRaf = requestAnimationFrame(glide)
  }

  /*
   * A scroll with no acceleration and no glide, for gestures that already carry
   * their own distance: the drag that pulls the canvas along at the edge, and
   * the thumb, which must land on the pixel it was dropped at.
   */
  function scrollByExact(dx: number): void {
    if (currentLayout === null || dx === 0 || zoomedPaneId !== null) return
    cancelAnimation()
    stopWheelGlide()
    const limit = maxScrollX(currentLayout, host.clientWidth)
    const next = Math.max(0, Math.min(scrollX + dx, limit))
    if (next !== scrollX) applyScroll(next)
  }

  /*
   * The thumb is draggable, so the indicator is the one piece of chrome that
   * takes the pointer. Capture is on the indicator itself — unlike the resize
   * handles it is never replaced mid-drag.
   */
  let thumbDrag: { readonly pointerId: number; last: number } | null = null

  indicator.addEventListener('pointerdown', (event) => {
    if (currentLayout === null || indicator.hidden || zoomedPaneId !== null) return
    event.preventDefault()
    try {
      indicator.setPointerCapture(event.pointerId)
    } catch {
      // Not capturable — the drag still works off the events that do arrive.
    }
    thumbDrag = { pointerId: event.pointerId, last: event.clientX }
    host.classList.add('canvas--thumb-dragging')
  })

  indicator.addEventListener('pointermove', (event) => {
    if (thumbDrag === null || currentLayout === null) return
    const dx = event.clientX - thumbDrag.last
    if (dx === 0) return
    thumbDrag.last = event.clientX
    scrollByExact(scrollForThumbDelta(dx, canvasWidthOf(), host.clientWidth))
  })

  function endThumbDrag(event: PointerEvent): void {
    if (thumbDrag === null) return
    if (indicator.hasPointerCapture(event.pointerId)) {
      indicator.releasePointerCapture(event.pointerId)
    }
    thumbDrag = null
    host.classList.remove('canvas--thumb-dragging')
  }

  indicator.addEventListener('pointerup', endThumbDrag)
  indicator.addEventListener('pointercancel', endThumbDrag)

  host.addEventListener(
    'wheel',
    (event) => {
      if (currentLayout === null) return

      // An open map wider than the window pans itself, and this handler claims
      // the wheel in capture — so it has to stand back or the map never moves.
      // A map that fits keeps letting the canvas scroll underneath.
      if ((event.target as HTMLElement).closest('.overview--pannable') !== null) return

      /*
       * Vertical wheel belongs to the terminal's scrollback. The canvas takes it
       * only when the horizontal component wins, the pointer is off a panel, or
       * Shift is held and that shortcut is enabled.
       */
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      const overTerminal = (event.target as HTMLElement).closest('.pane__body') !== null
      const shiftPans = hooks.shiftPans?.() ?? true
      if (!horizontal && overTerminal && !(event.shiftKey && shiftPans)) return

      const raw = horizontal ? event.deltaX : event.deltaY
      if (raw === 0) return
      event.preventDefault()
      // Claim it outright: xterm stops propagation under mouse tracking or an
      // alternate screen, so a pan decided on the way up would never arrive.
      event.stopPropagation()
      panBy(raw, event.deltaMode)
    },
    // Capture, for the same reason.
    { passive: false, capture: true },
  )

  /** Handles laid over the gaps, wider than the gap itself for easier aiming. */
  function renderHandles(layout: Layout): void {
    handles.replaceChildren()
    const columnHeight = columnHeightIn(host.clientHeight)
    let x = CANVAS_EDGE

    for (let i = 0; i < layout.columns.length; i++) {
      const column = layout.columns[i]!

      /*
       * The last column gets a handle too.
       *
       * Panes share a fixed column height, so the last one has nothing below to
       * take from. Column widths are absolute on an unbounded canvas, so
       * dragging the last edge simply widens or narrows the canvas.
       */
      const handle = document.createElement('div')
      handle.className = 'resize-handle resize-handle--column'
      handle.dataset['targetId'] = column.id
      handle.style.left = `${Math.round(x + column.width + PANE_GAP / 2 - HANDLE_HIT / 2)}px`
      handle.style.top = `${CANVAS_EDGE}px`
      handle.style.height = `${Math.round(columnHeight)}px`
      handles.append(handle)

      const columnRects = rects.filter((r) => r.columnId === column.id)
      for (let p = 0; p < columnRects.length - 1; p++) {
        const rect = columnRects[p]!
        const handle = document.createElement('div')
        handle.className = 'resize-handle resize-handle--pane'
        handle.dataset['targetId'] = rect.paneId
        handle.style.left = `${Math.round(rect.x)}px`
        handle.style.width = `${Math.round(rect.width)}px`
        handle.style.top = `${Math.round(rect.y + rect.height + PANE_GAP / 2 - HANDLE_HIT / 2)}px`
        handles.append(handle)
      }

      x += column.width + PANE_GAP
    }
  }

  return {
    root: track,

    render(layout) {
      currentLayout = layout
      rects = paneRects(layout, host.clientHeight)
      syncIndicator()

      const panes = new Map<string, Pane>()
      for (const column of layout.columns) {
        for (const pane of column.panes) panes.set(pane.id, pane)
      }

      const alive = new Set<string>()
      for (const rect of rects) {
        alive.add(rect.paneId)
        let view = views.get(rect.paneId)
        if (view === undefined) {
          // Reuse the element per pane; replacing it would destroy the xterm inside.
          view = createPaneView(rect.paneId)
          views.set(rect.paneId, view)
          track.append(view.element)
        }
        view.setRect(rect)
        view.setFocused(rect.paneId === layout.focusedPaneId)
        const pane = panes.get(rect.paneId)
        const title = pane?.title ?? ''
        view.setTitle(isDefaultPaneTitle(title) ? '' : title)
        // The bar names the pane even when the peek label would not: it is all
        // there is to go on, so a default title still beats an empty row.
        view.setFolded(pane?.minimized === true, {
          title,
          ...(foldDetails.get(rect.paneId) ?? { command: '', wants: false }),
        })
      }

      for (const [paneId, view] of views) {
        if (alive.has(paneId)) continue
        view.element.remove()
        views.delete(paneId)
        foldDetails.delete(paneId)
      }

      renderHandles(layout)
      applyZoom()

      // A narrower canvas can leave the view past its end.
      const limit = maxScrollX(layout, host.clientWidth)
      if (scrollX > limit) applyScroll(Math.max(0, limit))
    },

    clampScroll(layout) {
      const limit = maxScrollX(layout, host.clientWidth)
      const next = Math.max(0, Math.min(scrollX, limit))
      if (next !== scrollX) applyScroll(next)
    },

    scrollToPane(paneId, layout) {
      const target = scrollToReveal(rects, paneId, this.getViewport(), layout)
      if (target === null) return
      // Drop any wheel glide, or there would be two targets.
      stopWheelGlide()
      animateTo(target)
    },

    panBy,

    scrollByExact,

    scrollState() {
      return {
        offset: scrollX,
        viewport: host.clientWidth,
        total: canvasWidthOf(),
        left: host.getBoundingClientRect().left,
      }
    },

    setZoom(paneId) {
      if (paneId === zoomedPaneId) return
      const previous = zoomedPaneId
      zoomedPaneId = paneId
      if (previous !== null) {
        const view = views.get(previous)
        view?.setZoomed(false)
        // Straight back to the rect the layout has been holding all along.
        const rect = rects.find((r) => r.paneId === previous)
        if (view !== undefined && rect !== undefined) view.setRect(rect)
      }
      // Panes set no z-index of their own, so nothing inside one is trapped by
      // it: a peeked label at 4 would draw over the scrim and the zoomed pane.
      // The class gives every other pane a layer to hold its children in.
      track.classList.toggle('canvas-track--zoomed', paneId !== null)
      if (paneId !== null) {
        track.append(scrim)
        views.get(paneId)?.setZoomed(true)
        applyZoom()
      } else {
        scrim.remove()
      }
    },

    setFoldDetail(paneId, detail) {
      foldDetails.set(paneId, detail)
      const pane = currentLayout?.columns
        .flatMap((c) => c.panes)
        .find((p) => p.id === paneId)
      if (pane === undefined) return
      views.get(paneId)?.setFolded(pane.minimized === true, { title: pane.title, ...detail })
    },

    getViewport() {
      return { width: host.clientWidth, height: host.clientHeight, scrollX }
    },

    getRects() {
      return rects
    },

    paneBody(paneId) {
      return views.get(paneId)?.body ?? null
    },

    setPaneFrozen(paneId, frozen) {
      views.get(paneId)?.setFrozen(frozen)
    },

    destroy() {
      cancelAnimation()
      stopWheelGlide()
      for (const view of views.values()) view.element.remove()
      views.clear()
      track.remove()
      gutter.remove()
      gutterRight.remove()
      indicator.remove()
    },
  }
}
