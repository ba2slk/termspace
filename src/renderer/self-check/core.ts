import { api } from '../api'
import { IS_MAC } from '../platform'
import { AUTOSCROLL_STEP, AUTOSCROLL_ZONE } from '../edge-autoscroll'
import { CANVAS_BOTTOM, CANVAS_EDGE, maxColumnWidth } from '../layout-geometry'
import { DEFAULT_COLUMN_WIDTH, MIN_COLUMN_WIDTH, PANE_GAP } from '../layout-model'
import { MIN_OVERVIEW_COLUMN_PX } from '../overview-model'
import { MAX_WEBGL_CONTEXTS } from '../renderer-budget'
import {
  animationRuns,
  capture,
  focusedId,
  holdsStill,
  hoveredLinkOf,
  openSession,
  overlay,
  panes,
  press,
  RENDERER_CANVAS,
  type Report,
  resolveColor,
  selectedCard,
  SKIPPED,
  termOf,
  trackOffset,
  trackSettles,
  visiblePanes,
  waitFor,
  wheel,
} from './harness'

/** App shortcuts with no session open. Must run before any session is opened. */
export async function checkAppKeysWithoutSession(report: Report): Promise<void> {
  const workspace = document.querySelector<HTMLElement>('.workspace')
  if (workspace === null) {
    report['altSWithoutSession'] = 'FAIL (no workspace)'
    return
  }
  report['noSessionYet'] = visiblePanes().length === 0 ? 'ok' : 'FAIL (a session is already open)'

  const hiddenBefore = workspace.classList.contains('canvas--sidebar-hidden')
  press('KeyS', { altKey: true })
  await waitFor(() => workspace.classList.contains('canvas--sidebar-hidden') !== hiddenBefore)
  report['altSWithoutSession'] =
    workspace.classList.contains('canvas--sidebar-hidden') !== hiddenBefore
      ? 'ok'
      : 'FAIL (Alt+S does nothing with no session)'

  // Reopen the list — later checks pick a session from it.
  press('KeyS', { altKey: true })
  await waitFor(() => workspace.classList.contains('canvas--sidebar-hidden') === hiddenBefore)
}

export async function checkSessionAndPty(report: Report, bytes: Map<string, number>): Promise<void> {
  const sessions = await api.listSessions()
  report['sessions'] = sessions.map((s) => `${s.name}(${s.paneCount})`).join(',') || 'NONE'

  await openSession('verify')
  report['panes'] = String(panes().length)
  report['terminals'] = String(document.querySelectorAll('.terminal-host').length)
  report['title'] = document.title
  /*
   * Every pane has to receive something from its shell. Read after waiting, not
   * once: a shell that is slow to start had a pane reporting nothing at all,
   * which read as a broken pty (issue #11). Where not one pane produced a byte
   * the machine never started a shell, and that is unmeasurable, not broken.
   */
  const wantedPanes = panes().length
  const allSpoke = await waitFor(() => bytes.size >= wantedPanes, 20_000)
  report['everyPaneGotPtyData'] = allSpoke
    ? `ok (${bytes.size})`
    : bytes.size === 0
      ? 'skipped: no shell produced any output here'
      : `MISMATCH ${bytes.size}/${wantedPanes}`

  // Panes must fit inside the canvas.
  const host = document.querySelector<HTMLElement>('.session-host:not([hidden])')!
  const bottoms = panes().map(
    (p) => Number.parseInt(p.style.top || '0') + Number.parseInt(p.style.height || '0'),
  )
  report['canvasBox'] = `${host.clientWidth}x${host.clientHeight}`
  report['lowestPaneBottom'] = String(Math.max(...bottoms))
  report['panesFitVertically'] =
    Math.max(...bottoms) <= host.clientHeight ? 'ok' : `OVERFLOW (canvas ${host.clientHeight})`
  report['frozenRightAfterOpen'] = String(document.querySelectorAll('.pane--frozen').length)
}

export async function checkNavigation(report: Report): Promise<void> {
  const start = focusedId()
  press('ArrowRight', { altKey: true })
  await waitFor(() => focusedId() !== start)
  const moved = focusedId()
  report['focusMovesRight'] = moved !== start ? 'ok' : 'FAIL'

  press('ArrowRight', { altKey: true })
  const rightmost = focusedId()
  // The move is a glide: wait for it to start, then for where it comes to rest.
  await waitFor(() => trackOffset() !== 0, 2000)
  const offset = await trackSettles()
  report['canvasScrolled'] = !(await animationRuns())
    ? SKIPPED
    : offset < 0
      ? `ok (${offset}px)`
      : `FAIL (${offset})`

  press('ArrowLeft', { altKey: true })
  await waitFor(() => focusedId() !== rightmost)
  press('ArrowLeft', { altKey: true })
  await waitFor(() => focusedId() === start)
  report['roundTripReturns'] = focusedId() === start ? 'ok' : `MISMATCH (${start} → ${focusedId()})`

  press('ArrowDown', { altKey: true })
  await waitFor(() => focusedId() !== start)
  report['verticalMove'] = focusedId() !== start ? 'ok' : 'FAIL'
  press('ArrowUp', { altKey: true })
  await waitFor(() => focusedId() === start)
}

/*
 * Dragging a handle can only widen a column as far as the pointer can travel,
 * and the pointer stops at the screen. Holding it against the right border has
 * to keep the column growing on its own — which is the whole point, and is
 * invisible to a unit test because it is driven by frames.
 */
async function checkEdgeAutoScroll(report: Report, host: HTMLElement): Promise<void> {
  const track = host.querySelector<HTMLElement>('.canvas-track')
  if (track === null) {
    report['columnEdgeAutoScroll'] = 'FAIL (no canvas track)'
    return
  }
  if (!(await animationRuns())) {
    // The pull is one step per frame; an occluded window produces none.
    report['columnEdgeAutoScroll'] = SKIPPED
    return
  }

  /*
   * Reproduce the real case rather than a wide column: scroll to the end of the
   * canvas, where the last column's right edge — and so its handle — sits at
   * the border with the pointer having nowhere left to go. Jumping the pointer
   * to the border instead would widen the column by that jump in one step and
   * could park it at the cap, where nothing more can happen.
   */
  wheel(host, 0, 100_000)
  await trackSettles()

  const border = host.getBoundingClientRect().right
  /** The last column's handle, which max scroll has left against the border. */
  const lastHandle = (): HTMLElement | undefined =>
    [...host.querySelectorAll<HTMLElement>('.resize-handle--column')].sort(
      (a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left,
    )[0]

  const handle = lastHandle()
  if (handle === undefined) {
    report['columnEdgeAutoScroll'] = 'FAIL (no column handle to drag)'
    return
  }
  if (handle.getBoundingClientRect().left < border - AUTOSCROLL_ZONE) {
    // A canvas narrower than the window never puts a handle against the border.
    report['columnEdgeAutoScroll'] = 'skipped (canvas fits the window)'
    return
  }

  // The last column, measured through a pane sitting against that handle.
  const owner = [...host.querySelectorAll<HTMLElement>('.pane')].sort(
    (a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right,
  )[0]
  if (owner === undefined) {
    report['columnEdgeAutoScroll'] = 'FAIL (no pane in the last column)'
    return
  }
  const widthOf = (): number => owner.getBoundingClientRect().width
  const startWidth = widthOf()

  const at = { pointerId: 1, bubbles: true, cancelable: true, clientY: 200 }
  /** One press-move-release, from a freshly found handle to an absolute x. */
  const dragTo = async (x: number): Promise<void> => {
    const grip = lastHandle()
    if (grip === undefined) return
    const from = grip.getBoundingClientRect().left + 1
    grip.dispatchEvent(new PointerEvent('pointerdown', { ...at, clientX: from }))
    track.dispatchEvent(new PointerEvent('pointermove', { ...at, clientX: x }))
    track.dispatchEvent(new PointerEvent('pointerup', { ...at, clientX: x }))
    // The column reflows on the release; wait for the width to come to rest.
    await holdsStill(() => Math.round(owner.getBoundingClientRect().width), 2000)
  }

  /*
   * Make room to grow. Two things leave the column with nowhere to go: the cap
   * check just before this one widens it to fill the window, and a window
   * narrower than the session's own columns starts them past the cap already —
   * where holding still is the correct answer and there is nothing to see.
   *
   * Shrink to a fixed distance below the cap rather than by a fixed step: how
   * far above it the column starts depends on the window. Shrinking does not
   * move the handle off the border, since the canvas loses the same width and
   * max scroll brings its end back to it.
   */
  const cap = maxColumnWidth(host.clientWidth)
  const room = cap - AUTOSCROLL_STEP * 8
  if (room < MIN_COLUMN_WIDTH) {
    report['columnEdgeAutoScroll'] = `skipped (window too narrow to hold a column, cap ${String(Math.round(cap))}px)`
    return
  }
  if (startWidth > room) {
    const grip0 = lastHandle()
    if (grip0 !== undefined) {
      await dragTo(grip0.getBoundingClientRect().left + 1 - (startWidth - room))
    }
  }
  const grip = lastHandle()
  if (grip === undefined || grip.getBoundingClientRect().left < border - AUTOSCROLL_ZONE) {
    report['columnEdgeAutoScroll'] = 'skipped (no column left against the border)'
    return
  }

  const grabbed = grip.getBoundingClientRect()
  grip.dispatchEvent(new PointerEvent('pointerdown', { ...at, clientX: grabbed.left + 1 }))
  /*
   * One pixel, only to arm the loop — a press alone must not start widening.
   * Dispatch on the track, not the handle: the handle is rebuilt on the first
   * re-render and would stop listening mid-drag.
   */
  track.dispatchEvent(new PointerEvent('pointermove', { ...at, clientX: grabbed.left + 2 }))

  /*
   * Read the width now, not after a settling sleep: the room below the cap is
   * only a few frames wide, and waiting would let the loop spend all of it
   * before the first measurement — which then looks like a loop that never ran.
   * The move above was one pixel, well under the step this waits for.
   */
  const held = widthOf()
  const kept = await waitFor(() => widthOf() > held + AUTOSCROLL_STEP)
  const reached = widthOf()
  track.dispatchEvent(new PointerEvent('pointerup', { ...at, clientX: grabbed.left + 2 }))

  /*
   * Frames can stop after the gate above — the window only has to be covered
   * for the moment the loop was meant to run — and a loop with no frames looks
   * exactly like one that never started. Ask again before calling it broken.
   */
  report['columnEdgeAutoScroll'] = kept
    ? `ok (${String(Math.round(held))} → ${String(Math.round(reached))}px with the pointer still)`
    : (await animationRuns())
      ? `FAIL (held at ${String(Math.round(held))}px, reached ${String(Math.round(reached))}px; grabbed ${String(Math.round(grabbed.left))} of border ${String(Math.round(border))}, cap ${String(Math.round(cap))}, host ${String(Math.round(host.clientWidth))}/${String(Math.round(host.getBoundingClientRect().width))})`
      : SKIPPED

  /*
   * Put back both the column and the view. The checks after this one read the
   * focused pane's box, and a canvas parked at the far end leaves it off screen
   * — which freezes it, and reads there as a renderer budget failure.
   */
  const grip2 = lastHandle()
  if (grip2 !== undefined) {
    await dragTo(grip2.getBoundingClientRect().left + 1 - (widthOf() - startWidth))
  }
  press('KeyG', { altKey: true })
  await trackSettles()
}

export async function checkLayoutEditing(report: Report): Promise<void> {
  const before = panes().length
  press('ArrowDown', { altKey: true, shiftKey: true })
  await waitFor(() => panes().length === before + 1)
  report['splitDown'] = panes().length === before + 1 ? 'ok' : `FAIL ${before}→${panes().length}`
  report['splitFocusesNewPane'] =
    document.activeElement?.closest('.pane')?.getAttribute('data-pane-id') === focusedId()
      ? 'ok'
      : 'FAIL (the new pane did not take keyboard focus)'

  /*
   * Alt+U I O P resizes without the arrows. Run it here, where the column holds
   * two panes, so both the pane with a seam below it and the last one — which
   * has to borrow the seam above — get a turn.
   */
  const focusedBox = (): DOMRect | null =>
    document.querySelector<HTMLElement>('.pane--focused')?.getBoundingClientRect() ?? null

  const belowFirst = focusedId()
  press('ArrowUp', { altKey: true })
  await waitFor(() => focusedId() !== belowFirst)
  const heightBefore = focusedBox()?.height ?? 0
  press('KeyI', { altKey: true })
  await waitFor(() => (focusedBox()?.height ?? 0) > heightBefore + 1)
  const taller = focusedBox()?.height ?? 0
  press('KeyO', { altKey: true })
  await waitFor(() => (focusedBox()?.height ?? 0) < taller - 1)
  const shorter = focusedBox()?.height ?? 0
  report['resizeKeysHeight'] =
    taller > heightBefore && shorter < taller
      ? `ok (${String(Math.round(heightBefore))} → ${String(Math.round(taller))} → ${String(Math.round(shorter))}px)`
      : `FAIL (${String(Math.round(heightBefore))} → ${String(Math.round(taller))} → ${String(Math.round(shorter))}px)`

  /*
   * The bottom of a column has no seam below it and was a dead key. It borrows
   * the seam above instead, so Alt+I reads as "taller" wherever focus sits.
   */
  const topPane = focusedId()
  press('ArrowDown', { altKey: true })
  await waitFor(() => focusedId() !== topPane)
  const bottomBefore = focusedBox()?.height ?? 0
  press('KeyI', { altKey: true })
  const bottomGrew = await waitFor(() => (focusedBox()?.height ?? 0) > bottomBefore + 1)
  const bottomAfter = focusedBox()?.height ?? 0
  report['resizeLastPaneHeight'] = bottomGrew
    ? `ok (${String(Math.round(bottomBefore))} → ${String(Math.round(bottomAfter))}px)`
    : `FAIL (${String(Math.round(bottomBefore))} → ${String(Math.round(bottomAfter))}px)`

  // Put it back and return focus to the top pane; the move checks expect it there.
  press('KeyO', { altKey: true })
  await waitFor(() => (focusedBox()?.height ?? 0) < bottomAfter - 1)
  press('ArrowUp', { altKey: true })
  await waitFor(() => focusedId() === topPane)

  const host = document.querySelector<HTMLElement>('.session-host:not([hidden])')
  const cap = host === null ? 0 : maxColumnWidth(host.clientWidth)

  /*
   * Park the column midway between the two bounds before testing the keys.
   * Four windows share a screen here, so the check window is often narrower
   * than the column it holds, and a column at the cap cannot widen at all —
   * which would read as a broken key. Re-measure each press rather than assume
   * a step size: overshooting into either bound is what breaks the test.
   */
  const midpoint = (MIN_COLUMN_WIDTH + cap) / 2
  for (let i = 0; i < 30 && (focusedBox()?.width ?? 0) > midpoint; i++) {
    const wide = focusedBox()?.width ?? 0
    press('KeyU', { altKey: true })
    // A column already at the minimum cannot answer, so cap the wait short.
    await waitFor(() => (focusedBox()?.width ?? 0) !== wide, 300)
  }

  const widthBefore = focusedBox()?.width ?? 0
  press('KeyP', { altKey: true })
  await waitFor(() => (focusedBox()?.width ?? 0) > widthBefore + 1)
  const widened = focusedBox()?.width ?? 0
  press('KeyU', { altKey: true })
  await waitFor(() => (focusedBox()?.width ?? 0) < widened - 1)
  const narrowed = focusedBox()?.width ?? 0
  const widthTrace = `${String(Math.round(widthBefore))} → ${String(Math.round(widened))} → ${String(Math.round(narrowed))}px`
  report['resizeKeysWidth'] =
    host === null
      ? 'FAIL (no session host)'
      : widthBefore <= MIN_COLUMN_WIDTH || widthBefore >= cap
        ? `skipped (window leaves no room to resize, ${widthTrace})`
        : widened > widthBefore && narrowed < widened
          ? `ok (${widthTrace})`
          : `FAIL (${widthTrace})`

  /*
   * Widening has to stop where the column fills the viewport, not run forever.
   * A column already past the cap keeps its width rather than being pulled down
   * to it, so the ceiling is whichever of the two is larger.
   */
  if (host === null) {
    report['columnWidthCap'] = 'FAIL (no session host)'
  } else {
    const ceiling = Math.max(cap, focusedBox()?.width ?? 0)
    for (let i = 0; i < 60; i++) press('KeyP', { altKey: true })
    const stopped = await waitFor(() => Math.abs((focusedBox()?.width ?? 0) - ceiling) < 1)
    report['columnWidthCap'] = stopped
      ? `ok (stops at ${String(Math.round(ceiling))}px)`
      : `FAIL (${String(Math.round(focusedBox()?.width ?? 0))}px, ceiling ${String(Math.round(ceiling))}px)`

    /*
     * A column widened to the cap fits the viewport exactly, so the pane must
     * be whole on screen: the scroll follows the far edge instead of leaving it
     * clipped. Measure against the host's own box — the canvas is a transform,
     * so a pane past the right border still reports a rectangle.
     */
    const hostBox = host.getBoundingClientRect()
    const box = focusedBox()
    if (box === null) {
      report['resizeKeepsPaneOnScreen'] = 'FAIL (no focused pane)'
    } else if (!(await animationRuns())) {
      // The reveal is a glide; without frames the canvas never leaves where it was.
      report['resizeKeepsPaneOnScreen'] = SKIPPED
    } else if (box.width > hostBox.width) {
      report['resizeKeepsPaneOnScreen'] = 'skipped (window narrower than the column)'
    } else {
      const whole = await waitFor(() => {
        const now = focusedBox()
        return now !== null && now.right <= hostBox.right + 1 && now.left >= hostBox.left - 1
      })
      const now = focusedBox()
      report['resizeKeepsPaneOnScreen'] = whole
        ? `ok (right edge ${String(Math.round(now?.right ?? 0))} within ${String(Math.round(hostBox.right))}px)`
        : `FAIL (pane ${String(Math.round(now?.left ?? 0))}–${String(Math.round(now?.right ?? 0))}, host ${String(Math.round(hostBox.left))}–${String(Math.round(hostBox.right))}px)`
    }

    await checkEdgeAutoScroll(report, host)
  }

  /*
   * Moving: the column still holds two panes and the focused one is on top.
   * A swap must show up as the focused pane's box landing lower on screen —
   * same pane id, new pixels.
   */
  const movedId = focusedId()
  const topBefore = focusedBox()?.top ?? 0
  press('KeyI', { altKey: true, shiftKey: true })
  const swapped = await waitFor(() => (focusedBox()?.top ?? 0) > topBefore)
  report['movePaneSwap'] =
    swapped && focusedId() === movedId
      ? `ok (top ${String(Math.round(topBefore))} → ${String(Math.round(focusedBox()?.top ?? 0))}px)`
      : `FAIL (top ${String(Math.round(topBefore))} → ${String(Math.round(focusedBox()?.top ?? 0))}px, focus ${String(focusedId())})`

  /*
   * Horizontally the pane must land in the column to the right — joining it or
   * breaking out past the edge, whichever this session's layout puts there —
   * and a move back must land it where it started. Left edge is the tell;
   * which structural path was taken is the unit tests' business.
   */
  const leftBefore = focusedBox()?.left ?? 0
  press('KeyP', { altKey: true, shiftKey: true })
  const wentRight = await waitFor(() => (focusedBox()?.left ?? 0) > leftBefore)
  report['movePaneRight'] =
    wentRight && focusedId() === movedId
      ? `ok (left ${String(Math.round(leftBefore))} → ${String(Math.round(focusedBox()?.left ?? 0))}px)`
      : `FAIL (left ${String(Math.round(leftBefore))} → ${String(Math.round(focusedBox()?.left ?? 0))}px)`

  press('KeyU', { altKey: true, shiftKey: true })
  const cameBack = await waitFor(() => Math.abs((focusedBox()?.left ?? 0) - leftBefore) < 1)
  report['movePaneBack'] =
    cameBack && focusedId() === movedId
      ? 'ok'
      : `FAIL (left ${String(Math.round(focusedBox()?.left ?? 0))}px, expected ${String(Math.round(leftBefore))}px)`

  const columnsBefore = document.querySelectorAll('.resize-handle--column').length
  press('ArrowRight', { altKey: true, shiftKey: true })
  await waitFor(() => document.querySelectorAll('.resize-handle--column').length === columnsBefore + 1)
  const columnsAfter = document.querySelectorAll('.resize-handle--column').length
  report['addColumn'] =
    columnsAfter === columnsBefore + 1 ? 'ok' : `FAIL ${columnsBefore}→${columnsAfter}`

  const beforeClose = panes().length
  press('KeyW', { altKey: true, shiftKey: true })
  await waitFor(() => panes().length === beforeClose - 1)
  report['closePane'] =
    panes().length === beforeClose - 1 ? 'ok' : `FAIL ${beforeClose}→${panes().length}`
}

/**
 * Press or release the peek modifier: the same key that prefixes the focus
 * moves, Alt off mac and Cmd on it. Two checks hold it, so it lives out here.
 */
function holdPeek(type: 'keydown' | 'keyup'): void {
  window.dispatchEvent(
    new KeyboardEvent(type, {
      code: IS_MAC ? 'MetaLeft' : 'AltLeft',
      key: IS_MAC ? 'Meta' : 'Alt',
      bubbles: true,
      cancelable: true,
      altKey: !IS_MAC && type === 'keydown',
      metaKey: IS_MAC && type === 'keydown',
    }),
  )
}

/**
 * Zoom lays the focused pane over the visible canvas, and puts it back exactly.
 *
 * Measured in pixels: the class says only that the app agrees it is zoomed, and
 * what the feature promises is the box — the same insets every pane keeps, and
 * the rect it started from when the zoom is dropped.
 */
export async function checkPaneZoom(report: Report): Promise<void> {
  const host = document.querySelector<HTMLElement>('.session-host:not([hidden])')
  const pane = document.querySelector<HTMLElement>('.pane--focused')
  if (host === null || pane === null) {
    report['paneZoom'] = 'FAIL (no focused pane)'
    return
  }

  const before = pane.getBoundingClientRect()
  const canvas = host.getBoundingClientRect()
  const paneBorder = (): string => getComputedStyle(pane).borderTopColor
  const focusedBorder = paneBorder()
  /*
   * The bright end of the pair, resolved through the very expression the zoom
   * rule uses. Naming a colour would only pin one mode: white rests at full and
   * steps up by mixing white in, a tint rests held back and steps up to whole.
   */
  const zoomedBorder = resolveColor(
    'color-mix(in srgb, var(--focus-border, var(--border-active)) var(--focus-zoom), white)',
  )
  // A pixel of tolerance: the rects are rounded, and a fractional scale rounds
  // the window's own edges too.
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1
  const covers = (): boolean => {
    const box = pane.getBoundingClientRect()
    return (
      near(box.left, canvas.left + CANVAS_EDGE) &&
      near(box.top, canvas.top + CANVAS_EDGE) &&
      near(box.width, canvas.width - CANVAS_EDGE * 2) &&
      near(box.height, canvas.height - CANVAS_EDGE - CANVAS_BOTTOM)
    )
  }
  const boxText = (): string => {
    const box = pane.getBoundingClientRect()
    return `${String(Math.round(box.width))}x${String(Math.round(box.height))} at ${String(Math.round(box.left))},${String(Math.round(box.top))}`
  }

  press('KeyZ', { altKey: true })
  await waitFor(covers)
  report['paneZoomCoversCanvas'] = covers()
    ? `ok (${boxText()})`
    : `FAIL (${boxText()}, canvas ${String(Math.round(canvas.width))}x${String(Math.round(canvas.height))})`

  /*
   * The scrim behind the zoomed pane. Its rung is what hides the panes it
   * covers; read from the computed styles, since only the real stylesheet has
   * them.
   */
  const scrim = document.querySelector<HTMLElement>('.zoom-scrim')
  const scrimBox = scrim?.getBoundingClientRect()
  const stacked =
    scrim !== null &&
    Number(getComputedStyle(scrim).zIndex) < Number(getComputedStyle(pane).zIndex)
  report['paneZoomScrim'] =
    scrimBox !== undefined && stacked && near(scrimBox.width, canvas.width) && near(scrimBox.height, canvas.height)
      ? 'ok'
      : `FAIL (${scrim === null ? 'absent' : `${String(Math.round(scrimBox?.width ?? 0))}x${String(Math.round(scrimBox?.height ?? 0))}, stacked ${String(stacked)}`})`

  /*
   * The zoom has no chrome of its own; the border is the whole signal, and it
   * says "zoomed" by being one step brighter than the resting focus. Both
   * halves are asserted: the resolved colour is what the rule promises, and
   * differing from the resting one is the promise the user can actually see —
   * a pair of knobs set to the same share would satisfy the first alone.
   */
  await waitFor(() => paneBorder() === zoomedBorder)
  report['paneZoomBorder'] =
    paneBorder() !== zoomedBorder
      ? `FAIL (${paneBorder()}, expected ${zoomedBorder})`
      : zoomedBorder === focusedBorder
        ? `FAIL (zoomed and resting both ${zoomedBorder})`
        : `ok (${focusedBorder} → ${zoomedBorder})`

  /*
   * Peek while zoomed. A pane sets no z-index, so its label at 4 used to climb
   * the track's ladder and draw over the scrim and the zoomed pane at 3.
   * Asked of the compositor rather than of the styles: elementFromPoint at the
   * label's own centre returns whatever is actually painted on top there, so
   * anything but the label itself means the zoomed pane covers it.
   */
  const hiddenLabels = (): HTMLElement[] =>
    visiblePanes()
      .filter((other) => other !== pane)
      .flatMap((other) => [...other.querySelectorAll<HTMLElement>('.pane__label')])
      .filter((label) => getComputedStyle(label).display !== 'none')
  if (typeof document.elementFromPoint !== 'function') {
    report['paneZoomHidesOtherLabels'] = 'skipped: elementFromPoint is unavailable'
  } else if (visiblePanes().length < 2) {
    report['paneZoomHidesOtherLabels'] = 'skipped: nothing is behind the zoomed pane'
  } else {
    holdPeek('keydown')
    await waitFor(() => hiddenLabels().length > 0)
    const behind = hiddenLabels()
    const onTop = behind.filter((label) => {
      const box = label.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return hit === label
    })
    report['paneZoomHidesOtherLabels'] =
      behind.length === 0
        ? 'skipped: no other pane is labelled on screen'
        : onTop.length === 0
          ? `ok (${String(behind.length)} behind the zoom)`
          : `FAIL (${String(onTop.length)} of ${String(behind.length)} labels drawn over the zoomed pane)`
    holdPeek('keyup')
    await waitFor(() => hiddenLabels().length === 0)
  }

  const restored = (): boolean => {
    const box = pane.getBoundingClientRect()
    return (
      near(box.left, before.left) &&
      near(box.top, before.top) &&
      near(box.width, before.width) &&
      near(box.height, before.height)
    )
  }
  press('KeyZ', { altKey: true })
  await waitFor(restored)
  // Back to the resting strength it was read at, not merely off the full one.
  report['paneZoomBorderRestores'] =
    paneBorder() === focusedBorder
      ? 'ok'
      : `FAIL (${paneBorder()}, expected ${focusedBorder})`
  report['paneZoomRestores'] = restored()
    ? 'ok'
    : `MISMATCH (${boxText()}, was ${String(Math.round(before.width))}x${String(Math.round(before.height))} at ${String(Math.round(before.left))},${String(Math.round(before.top))})`

  /*
   * A focus move out of a zoom takes two presses. The neighbours are off screen
   * under a zoom, so the first arrow only drops it and focus stays put; the
   * second aims with the layout back in view. Both halves are worth pinning:
   * the first press moving focus would be a blind jump, and the second failing
   * to move would mean the zoom had swallowed the key for good.
   */
  const zoomedId = focusedId()
  press('KeyZ', { altKey: true })
  await waitFor(covers)
  if (!covers()) {
    report['paneZoomFocusMoveDropsTheZoomOnly'] = 'FAIL (the pane would not zoom again)'
    return
  }
  press('ArrowRight', { altKey: true })
  await waitFor(restored)
  report['paneZoomFocusMoveDropsTheZoomOnly'] =
    restored() && focusedId() === zoomedId
      ? 'ok'
      : `FAIL (zoom ${restored() ? 'gone' : 'still on'}, focus ${String(focusedId())} was ${String(zoomedId)})`

  /*
   * Whether the next press has anywhere to go, read off the boxes rather than
   * assumed: the checks before this one rearrange the layout, so the pane that
   * ends up focused here is not always the one that started with a neighbour.
   */
  const focusedBox = pane.getBoundingClientRect()
  const hasRightNeighbour = visiblePanes().some(
    (other) => other !== pane && other.getBoundingClientRect().left >= focusedBox.right,
  )
  if (!hasRightNeighbour) {
    report['paneZoomSecondPressMovesFocus'] = 'skipped: nothing to the right of the zoomed pane'
    return
  }
  press('ArrowRight', { altKey: true })
  await waitFor(() => focusedId() !== zoomedId)
  const landed = focusedId()
  report['paneZoomSecondPressMovesFocus'] =
    landed !== zoomedId ? `ok (${String(zoomedId)} → ${String(landed)})` : 'FAIL (focus stayed put)'

  // Put the focus, and the scroll the move dragged along, back where they were.
  press('ArrowLeft', { altKey: true })
  await waitFor(() => focusedId() === zoomedId)
  await trackSettles()
}

export function checkRendererBudget(report: Report): void {
  const frozen = document.querySelectorAll('.pane--frozen').length
  report['frozenOffscreenPanes'] = frozen > 0 ? `ok (${frozen})` : 'FAIL (nothing froze)'

  /*
   * The cap is the invariant that matters: past Chromium's own limit it starts
   * force-releasing contexts, which is the flicker this budget exists to
   * prevent. Frozen-and-attached is not a fault — freeze follows visibility,
   * attach is capped, and renderer-budget keeps them deliberately separate, so
   * a pane that just scrolled off keeps its context until it falls out of the
   * ranking.
   */
  const contexts = document.querySelectorAll(`.pane ${RENDERER_CANVAS}`).length
  report['webglUnderTheCap'] =
    contexts <= MAX_WEBGL_CONTEXTS
      ? `ok (${String(contexts)} of ${String(MAX_WEBGL_CONTEXTS)})`
      : `FAIL (${String(contexts)} contexts, cap ${String(MAX_WEBGL_CONTEXTS)})`
  report['webglInFrozenPanes'] = String(
    document.querySelectorAll(`.pane--frozen ${RENDERER_CANVAS}`).length,
  )
  report['webglInAwakePanes'] = String(
    document.querySelectorAll(`.pane:not(.pane--frozen) ${RENDERER_CANVAS}`).length,
  )
}

/**
 * The grid fills the pane it is in.
 *
 * The WebGL renderer rounds the cell to whole device pixels and the DOM
 * renderer does not, so swapping them changes how many columns fit. A pane
 * fitted before its WebGL context arrived kept the DOM renderer's answer and
 * sat several columns short of its own right edge, for as long as the session
 * was open — a band of empty background nothing in the DOM would show.
 */
export async function checkGridFillsPane(report: Report): Promise<void> {
  const awake = (): HTMLElement[] => [
    ...document.querySelectorAll<HTMLElement>('.pane:not(.pane--frozen) .terminal-host'),
  ]
  // The fit follows the renderer swap, which waits for the view to settle.
  await waitFor(() => awake().some((host) => host.querySelector(RENDERER_CANVAS) !== null))

  let worst = 0
  let worstCells = 0
  const measure = (): number => {
    worst = 0
    worstCells = 0
    for (const host of awake()) {
      const screen = host.querySelector<HTMLElement>('.xterm-screen')
      const term = termOf(host)
      if (screen === null || term === undefined) continue
      const drawn = screen.getBoundingClientRect().width
      if (drawn === 0) continue // occluded or mid-swap; unmeasurable, not broken
      const gap = host.clientWidth - drawn
      const cells = gap / (drawn / term.cols)
      if (gap > worst) {
        worst = gap
        worstCells = cells
      }
    }
    return worstCells
  }
  /*
   * Nothing is reserved for the scrollbar any more, so the only leftover is the
   * sub-cell remainder: a column that does not fit does not fit. The tolerance
   * is one cell plus a sliver for the float maths behind the measurement.
   *
   * A pane that was just resized refits on the next observed frame, so wait for
   * the answer rather than reading whichever moment this check happened to land
   * in — on a loaded machine that moment is often mid-refit.
   */
  await waitFor(() => measure() < 1.05, 8000)
  report['gridFillsPane'] =
    worstCells < 1.05
      ? `ok (${worst.toFixed(0)}px left over)`
      : `FAIL ${worstCells.toFixed(1)} columns of empty pane`
}

/**
 * Focus cues. Whether they are strong enough is a human call; whether they
 * exist at all is measurable here.
 */
export function checkFocusVisibility(report: Report): void {
  const focused = document.querySelector<HTMLElement>('.session-host:not([hidden]) .pane--focused')
  const idle = visiblePanes().find((p) => !p.classList.contains('pane--focused'))
  if (focused === undefined || focused === null || idle === undefined) {
    report['focusVisibility'] = 'FAIL (nothing to compare)'
    return
  }

  const focusedBorder = getComputedStyle(focused).borderTopColor
  const idleBorder = getComputedStyle(idle).borderTopColor
  report['focusBorderDiffers'] =
    focusedBorder !== idleBorder ? 'ok' : `FAIL (both are ${focusedBorder})`

  // The ring is a hard 1px line, not a shadow.
  report['focusRing'] =
    getComputedStyle(focused).boxShadow !== 'none' ? 'ok' : 'FAIL (no ring)'

  // Unfocused panes get the scrim; the focused one must not.
  const scrimOf = (pane: HTMLElement): string => {
    const body = pane.querySelector<HTMLElement>('.pane__body')
    return body === null ? 'none' : getComputedStyle(body, '::after').backgroundColor
  }
  const idleScrim = scrimOf(idle)
  const focusedScrim = scrimOf(focused)
  report['idleScrim'] =
    idleScrim !== 'rgba(0, 0, 0, 0)' && idleScrim !== '' ? 'ok' : 'FAIL (no scrim)'
  report['focusedHasNoScrim'] =
    focusedScrim === 'rgba(0, 0, 0, 0)' || focusedScrim === ''
      ? 'ok'
      : `FAIL (the focused pane has a scrim too: ${focusedScrim})`
}

/**
 * The canvas host must not be scrollable by the browser.
 *
 * Its own scrolling is a transform on the track. A host the browser can also
 * scroll gets moved behind the app's back: xterm parks its textarea on the
 * cursor cell, and typing past the window's edge makes Chromium reveal that
 * caret by scrolling the nearest scroll container. The right gutter then sits
 * in the middle of the window as a dark bar, and nothing in the app resets it.
 */
export function checkCanvasHostScrollLock(report: Report): void {
  const host = document.getElementById('canvas')
  if (host === null) {
    report['canvasHostScrollLock'] = 'FAIL (no canvas)'
    return
  }
  const before = host.scrollLeft
  host.scrollLeft = 300
  const after = host.scrollLeft
  host.scrollLeft = before
  report['canvasHostScrollLock'] =
    after === 0 ? 'ok' : `FAIL (the browser scrolled the canvas host to ${String(after)}px)`

  // Where the browser scrolled the host, the right gutter is what shows.
  const gutter = document.querySelector<HTMLElement>('.canvas-gutter--right')
  if (gutter === null) {
    report['rightGutterAtWindowEdge'] = 'FAIL (no right gutter)'
    return
  }
  const gap = Math.abs(host.getBoundingClientRect().right - gutter.getBoundingClientRect().right)
  report['rightGutterAtWindowEdge'] = gap < 1 ? 'ok' : `FAIL (${String(Math.round(gap))}px in)`
}

/**
 * Peek: holding the move modifier labels every pane, releasing it clears them.
 *
 * Measured in pixels rather than by class: the label is an overlay on a pane
 * that must not spill past its own rectangle onto the neighbour beside it.
 */
export async function checkPaneTitlePeek(report: Report): Promise<void> {
  const canvas = document.getElementById('canvas')
  if (canvas === null) {
    report['peekLabels'] = 'FAIL (no canvas)'
    return
  }

  const shown = (): HTMLElement[] =>
    visiblePanes()
      .flatMap((pane) => [...pane.querySelectorAll<HTMLElement>('.pane__label')])
      .filter((label) => getComputedStyle(label).display !== 'none')

  holdPeek('keydown')
  await waitFor(() => shown().length > 0)
  const labels = shown()
  if (labels.length === 0) {
    holdPeek('keyup')
    report['peekLabels'] = 'FAIL (holding the modifier showed none)'
    return
  }
  report['peekLabels'] = `ok (${String(labels.length)} of ${String(visiblePanes().length)} panes)`

  // Every pane in this session is named, so every unfrozen one is labelled.
  const named = visiblePanes().filter(
    (pane) => !pane.classList.contains('pane--frozen') && (pane.querySelector('.pane__label')?.textContent ?? '') !== '',
  )
  report['peekLabelsEveryNamedPane'] =
    labels.length === named.length
      ? 'ok'
      : `FAIL (${String(labels.length)} labels for ${String(named.length)} named panes)`

  /*
   * Inside its own pane, and clear of the pane to its right. A label wider than
   * the pane would sit over a neighbour's terminal, which is what the ellipsis
   * is there to prevent.
   */
  const sorted = [...visiblePanes()].sort(
    (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left,
  )
  let contained = 0
  let spilled = ''
  for (const pane of sorted) {
    const label = pane.querySelector<HTMLElement>('.pane__label')
    if (label === null || getComputedStyle(label).display === 'none') continue
    const paneRect = pane.getBoundingClientRect()
    const rect = label.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      spilled = `label in ${String(pane.dataset['paneId'])} measures zero`
      break
    }
    const inside =
      rect.left >= paneRect.left - 1 &&
      rect.right <= paneRect.right + 1 &&
      rect.top >= paneRect.top - 1 &&
      rect.bottom <= paneRect.bottom + 1
    if (!inside) {
      spilled = `label of ${String(pane.dataset['paneId'])} leaves its pane`
      break
    }
    const right = sorted.find((other) => other.getBoundingClientRect().left > paneRect.right)
    if (right !== undefined && rect.right > right.getBoundingClientRect().left) {
      spilled = `label of ${String(pane.dataset['paneId'])} reaches the pane to its right`
      break
    }
    contained++
  }
  report['peekLabelsStayInsideTheirPane'] =
    spilled === '' ? `ok (${String(contained)} measured)` : `FAIL (${spilled})`

  // The strip names the focused pane while the label says the same title.
  const focusedLabel = document
    .querySelector<HTMLElement>('.session-host:not([hidden]) .pane--focused .pane__label')
    ?.textContent
  const bar = document.querySelector<HTMLElement>('.app-bar__title')?.textContent ?? ''
  report['barNamesTheFocusedPane'] =
    focusedLabel === undefined || focusedLabel === null || focusedLabel === ''
      ? 'skipped: the focused pane has no title of its own'
      : bar.endsWith(focusedLabel) && bar !== focusedLabel
        ? `ok (${bar})`
        : `FAIL (bar reads "${bar}", pane is "${focusedLabel}")`

  holdPeek('keyup')
  await waitFor(() => shown().length === 0)
  report['peekLabelsGoOnRelease'] =
    shown().length === 0 ? 'ok' : `FAIL (${String(shown().length)} left on screen)`
}

/** The overview: one card per pane, selection moves, Enter jumps, Esc doesn't. */
export async function checkOverview(report: Report): Promise<void> {
  const selected = selectedCard

  const startFocus = focusedId()
  press('KeyM', { altKey: true })
  await waitFor(() => overlay() !== null)
  if (overlay() === null) {
    report['overviewOpens'] = 'FAIL (Alt+M did not open it)'
    return
  }
  report['overviewOpens'] = 'ok'

  const cards = overlay()!.querySelectorAll('.overview__card')
  report['overviewCards'] =
    cards.length === visiblePanes().length
      ? `ok (${cards.length})`
      : `MISMATCH ${cards.length}/${visiblePanes().length}`

  // The map must actually fit the screen — that is the whole point of it.
  const host = document.querySelector<HTMLElement>('.session-host:not([hidden])')!
  const mapBox = overlay()!.querySelector<HTMLElement>('.overview__map')!.getBoundingClientRect()
  // A strip wider than the window is the point of pan mode; only a map that
  // claims to fit has to. Height must fit either way.
  const pans = overlay()!.classList.contains('overview--pannable')
  report['overviewFits'] =
    mapBox.width > 0 && (pans || mapBox.width <= host.clientWidth) && mapBox.height <= host.clientHeight
      ? `ok (${Math.round(mapBox.width)}x${Math.round(mapBox.height)} in ${host.clientWidth}x${host.clientHeight}${pans ? ', panning' : ''})`
      : `OVERFLOW (map ${Math.round(mapBox.width)}x${Math.round(mapBox.height)})`

  report['overviewMarksViewport'] = overlay()!.querySelector('.overview__viewport') !== null ? 'ok' : 'FAIL'

  // The scrim must actually cover the canvas, and darken it.
  const overlayBox = overlay()!.getBoundingClientRect()
  const hostBox = host.getBoundingClientRect()
  const scrim = getComputedStyle(overlay()!).backgroundColor
  report['overviewScrimCovers'] =
    Math.abs(overlayBox.width - hostBox.width) < 2 && Math.abs(overlayBox.height - hostBox.height) < 2
      ? 'ok'
      : `FAIL (overlay ${Math.round(overlayBox.width)}x${Math.round(overlayBox.height)} vs host ${Math.round(hostBox.width)}x${Math.round(hostBox.height)})`
  report['overviewScrimTinted'] =
    scrim !== 'rgba(0, 0, 0, 0)' && scrim !== 'transparent' ? `ok (${scrim})` : `FAIL (${scrim})`

  // Cards must be the panes shrunk by one factor: same width ratios, boxes as styled.
  const cardBoxes = [...overlay()!.querySelectorAll<HTMLElement>('.overview__card')].map((el) => ({
    id: el.dataset['paneId'] ?? '',
    styled: {
      w: Number.parseFloat(el.style.width),
      h: Number.parseFloat(el.style.height),
      x: Number.parseFloat(el.style.left),
      y: Number.parseFloat(el.style.top),
    },
    box: el.getBoundingClientRect(),
  }))
  const mapOrigin = overlay()!.querySelector<HTMLElement>('.overview__map')!.getBoundingClientRect()
  const boxMismatch = cardBoxes.find(
    (c) =>
      Math.abs(c.box.width - c.styled.w) > 1 ||
      Math.abs(c.box.height - c.styled.h) > 1 ||
      Math.abs(c.box.left - mapOrigin.left - c.styled.x) > 1 ||
      Math.abs(c.box.top - mapOrigin.top - c.styled.y) > 1,
  )
  report['overviewCardsAsStyled'] =
    boxMismatch === undefined
      ? 'ok'
      : `MISMATCH ${boxMismatch.id}: styled ${Math.round(boxMismatch.styled.x)},${Math.round(boxMismatch.styled.y)} ${Math.round(boxMismatch.styled.w)}x${Math.round(boxMismatch.styled.h)} drawn ${Math.round(boxMismatch.box.left - mapOrigin.left)},${Math.round(boxMismatch.box.top - mapOrigin.top)} ${Math.round(boxMismatch.box.width)}x${Math.round(boxMismatch.box.height)}`

  const paneWidths = new Map(
    visiblePanes().map((p) => [p.dataset['paneId'] ?? '', Number.parseFloat(p.style.width)]),
  )
  const first = cardBoxes[0]
  const ratioMismatch = cardBoxes.find((c) => {
    const want = (paneWidths.get(c.id) ?? 0) / (paneWidths.get(first?.id ?? '') ?? 1)
    return Math.abs(c.styled.w / (first?.styled.w ?? 1) - want) > 0.05
  })
  report['overviewProportional'] =
    ratioMismatch === undefined ? 'ok' : `MISMATCH ${ratioMismatch.id} (card ${ratioMismatch.styled.w}px, pane ${paneWidths.get(ratioMismatch.id)}px)`
  /*
   * Fit mode opens on the focused pane. Pan mode opens on the canvas region you
   * were looking at, so the selection is that column's pick — the focused pane
   * only keeps it when the lens actually frames it.
   */
  const framesTheSelection = (): boolean => {
    const card = overlay()?.querySelector<HTMLElement>(
      `.overview__card[data-pane-id="${String(selected())}"]`,
    )
    const lens = overlay()?.querySelector<HTMLElement>('.overview__viewport')
    if (card === null || card === undefined || lens === null || lens === undefined) return false
    const c = card.getBoundingClientRect()
    const l = lens.getBoundingClientRect()
    return c.left < l.right && c.right > l.left
  }
  report['overviewStartsAtFocus'] = pans
    ? framesTheSelection()
      ? `ok (pan mode: the lens frames ${String(selected())})`
      : `FAIL (the lens does not frame the selection ${String(selected())})`
    : selected() === startFocus
      ? 'ok'
      : `FAIL (${selected()} != ${startFocus})`

  // Selection must move; which way depends on where focus sits, so try both.
  const before = selected()
  press('ArrowRight')
  if (selected() === before) press('ArrowLeft')
  const moved = selected()
  report['overviewSelectionMoves'] = moved !== before ? 'ok' : 'FAIL (selection stuck)'

  // The marker must be readable among the card borders: clearly heavier than
  // them, and nothing else — a fill washed out the cards it covered. Computed
  // border widths snap to device pixels (dpr can be fractional), so compare
  // against a card, not against a CSS constant.
  const markerEl = overlay()!.querySelector<HTMLElement>('.overview__viewport')!
  const markerStyle = getComputedStyle(markerEl)
  const cardBorder = Number.parseFloat(
    getComputedStyle(overlay()!.querySelector('.overview__card')!).borderTopWidth,
  )
  const markerBorder = Number.parseFloat(markerStyle.borderTopWidth)
  const markerFill = markerStyle.backgroundColor
  const unfilled = markerFill === 'rgba(0, 0, 0, 0)' || markerFill === 'transparent'
  report['overviewMarkerVisible'] =
    markerBorder > cardBorder + 0.5 && unfilled
      ? `ok (border ${markerBorder}px vs card ${cardBorder}px, no fill)`
      : `FAIL (border ${markerBorder}px vs card ${cardBorder}px, fill ${markerFill})`

  // The canvas still wheels under the open map; the marker must follow live.
  if (Number.parseFloat(markerEl.style.width) >= mapBox.width - 1) {
    report['overviewMarkerFollowsWheel'] = 'skipped (canvas fits the viewport)'
  } else {
    const markerLeftBefore = Number.parseFloat(markerEl.style.left)
    // Wheel toward whichever end has room, or a maxed-out scroll absorbs it.
    const delta = markerLeftBefore > 1 ? -600 : 600
    wheel(overlay(), 0, delta)
    await waitFor(() => Number.parseFloat(markerEl.style.left) !== markerLeftBefore)
    const markerLeftAfter = Number.parseFloat(markerEl.style.left)
    report['overviewMarkerFollowsWheel'] =
      markerLeftAfter !== markerLeftBefore
        ? `ok (${Math.round(markerLeftBefore)} → ${Math.round(markerLeftAfter)}px)`
        : // The wheel glides, so a window that stopped compositing between the
          // gate above and here cannot move the marker. Unmeasurable, not broken.
          (await animationRuns())
          ? 'FAIL (marker did not move)'
          : SKIPPED
  }

  // The legend reads as the map's own footer, so it must follow the map's
  // bottom edge — pinned to the window it drifts away on a short map.
  const legendEl = overlay()!.querySelector<HTMLElement>('.overview__legend')
  if (legendEl === null) {
    report['overviewLegendUnderMap'] = 'FAIL (no legend)'
  } else {
    const gap = legendEl.getBoundingClientRect().top - mapBox.bottom
    report['overviewLegendUnderMap'] =
      gap > 8 && gap < 28 ? `ok (${Math.round(gap)}px under the map)` : `FAIL (${Math.round(gap)}px)`
    report['overviewLegendKeys'] = legendEl.textContent ?? ''
  }

  // Shot while open — the map's look can only be judged by eyes. No focus
  // claim here: only the motion group may pull focus (see GROUPS).
  await capture(report, 'overview')

  // Esc leaves without jumping.
  press('Escape')
  await waitFor(() => overlay() === null)
  report['overviewEscCloses'] = overlay() === null ? 'ok' : 'FAIL'
  report['overviewEscKeepsFocus'] =
    focusedId() === startFocus ? 'ok' : `FAIL (${focusedId()} != ${startFocus})`

  // Enter jumps to the selection.
  press('KeyM', { altKey: true })
  await waitFor(() => overlay() !== null)
  press('ArrowRight')
  if (selected() === startFocus) press('ArrowLeft')
  const target = selected()
  press('Enter')
  await waitFor(() => overlay() === null && focusedId() === target)
  report['overviewEnterJumps'] =
    overlay() === null && focusedId() === target ? 'ok' : `FAIL (focus ${focusedId()}, want ${target})`

  // Put focus back where the check found it.
  const start =
    startFocus === undefined ? null : document.querySelector(`[data-pane-id="${startFocus}"]`)
  start?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await waitFor(() => focusedId() === startFocus)
  report['overviewUndone'] = focusedId() === startFocus ? 'ok' : 'FAIL (focus not restored)'
}

/**
 * A session too wide to fit readably: the map stops scaling down at the floor
 * and pans instead. Neither the floor nor the pan is visible without real
 * pixels — a unit test sees the numbers, not whether a card ends up 40px wide.
 */
export async function checkOverviewScaleFloor(report: Report): Promise<void> {
  const host = document.querySelector<HTMLElement>('.session-host:not([hidden])')
  if (host === null) {
    report['overviewFloor'] = 'skipped: no session on screen'
    return
  }
  const selected = selectedCard

  /** The canvas scroll, read off the track's own transform — real pixels. */
  const canvasScroll = (): number => {
    const track = document.querySelector<HTMLElement>('.session-host:not([hidden]) .canvas-track')
    const match = /translateX\((-?[\d.]+)px\)/.exec(track?.style.transform ?? '')
    return match === null ? 0 : -Number(match[1])
  }

  const paneWidth = (p: HTMLElement): number => Number.parseFloat(p.style.width)
  const canvasSpan = (): number =>
    Math.max(...visiblePanes().map((p) => Number.parseFloat(p.style.left) + paneWidth(p))) +
    CANVAS_EDGE
  // Added columns come in at the default width, so they may be the narrowest.
  const narrowest = Math.min(...visiblePanes().map(paneWidth), DEFAULT_COLUMN_WIDTH)

  // 96 = 2 × OVERVIEW_MARGIN in overview-model.ts. Below the floor the map is
  // canvas × floor, so this is the canvas width that first overflows the room.
  const room = host.clientWidth - 96
  const floor = MIN_OVERVIEW_COLUMN_PX / narrowest
  const missing = room / floor - canvasSpan()
  const adds = Math.max(1, Math.ceil(missing / (DEFAULT_COLUMN_WIDTH + PANE_GAP)) + 1)
  if (adds > 4) {
    report['overviewFloor'] = `skipped: window too wide (${String(adds)} extra columns needed)`
    return
  }

  const startFocus = focusedId()
  const addedIds: string[] = []
  for (let i = 0; i < adds; i++) {
    const before = document.querySelectorAll('.resize-handle--column').length
    press('ArrowRight', { altKey: true, shiftKey: true })
    await waitFor(() => document.querySelectorAll('.resize-handle--column').length === before + 1)
    const id = focusedId()
    if (id !== undefined && id !== startFocus) addedIds.push(id)
  }

  const undo = async (): Promise<void> => {
    for (const id of addedIds) {
      const pane = document.querySelector(`[data-pane-id="${id}"]`)
      if (pane === null) continue
      pane.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      await waitFor(() => focusedId() === id)
      press('KeyW', { altKey: true, shiftKey: true })
      await waitFor(() => document.querySelector(`[data-pane-id="${id}"]`) === null)
    }
    const start =
      startFocus === undefined ? null : document.querySelector(`[data-pane-id="${startFocus}"]`)
    start?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await waitFor(() => focusedId() === startFocus)
    report['overviewFloorUndone'] =
      visiblePanes().length > 0 && focusedId() === startFocus
        ? 'ok'
        : `FAIL (${String(addedIds.length)} columns added, focus ${String(focusedId())})`
  }

  /*
   * Focus the leftmost pane before opening. Adding columns left focus at the
   * right end, where the walk below also ends — and a map that re-reveals the
   * focused card on every repaint would then look correct by coincidence.
   */
  const leftmost = visiblePanes().sort(
    (a, b) => Number.parseFloat(a.style.left) - Number.parseFloat(b.style.left),
  )[0]
  leftmost?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await waitFor(() => focusedId() === leftmost?.dataset['paneId'])

  press('KeyM', { altKey: true })
  await waitFor(() => overlay() !== null)
  const openedScroll = canvasScroll()
  const map = overlay()?.querySelector<HTMLElement>('.overview__map') ?? null
  if (map === null) {
    report['overviewFloor'] = 'FAIL (Alt+M did not open the map)'
    await undo()
    return
  }

  // A card is a whole column scaled, so the floor lands on the card itself;
  // 1px covers device-pixel rounding of the border.
  const cardWidths = [...overlay()!.querySelectorAll<HTMLElement>('.overview__card')].map(
    (el) => el.getBoundingClientRect().width,
  )
  const narrowestCard = Math.min(...cardWidths)
  report['overviewCardsStayReadable'] =
    narrowestCard >= MIN_OVERVIEW_COLUMN_PX - 1
      ? `ok (narrowest card ${String(Math.round(narrowestCard))}px over ${String(cardWidths.length)} cards)`
      : `FAIL (narrowest card ${String(Math.round(narrowestCard))}px, floor ${String(MIN_OVERVIEW_COLUMN_PX)}px)`

  const mapWidth = map.getBoundingClientRect().width
  if (!overlay()!.classList.contains('overview--pannable')) {
    report['overviewFloorPans'] =
      `skipped: map still fits (${String(Math.round(mapWidth))}px in ${String(host.clientWidth)}px)`
  } else {
    // Flex must not shrink the map back to the window, or the strip would carry
    // the cards outside the box they are positioned in.
    const styledWidth = Number.parseFloat(map.style.width)
    report['overviewMapKeepsItsWidth'] =
      Math.abs(mapWidth - styledWidth) < 1
        ? `ok (${String(Math.round(mapWidth))}px in ${String(host.clientWidth)}px)`
        : `FAIL (drawn ${String(Math.round(mapWidth))}px, styled ${String(Math.round(styledWidth))}px)`

    /*
     * The strip is cut --edge short of the host, so it breathes like the rest
     * of the app. Two measurements: the band's own inset, and that nothing of
     * a card actually paints inside it.
     */
    const clipBox = overlay()!.querySelector<HTMLElement>('.overview__clip')!.getBoundingClientRect()
    const hostBox = host.getBoundingClientRect()
    const insets = [clipBox.left - hostBox.left, hostBox.right - clipBox.right]
    const edge = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--edge'),
    )
    report['overviewStripBreathes'] = insets.every((i) => Math.abs(i - edge) < 1)
      ? `ok (${insets.map((i) => i.toFixed(1)).join(' / ')}px, --edge ${String(edge)}px)`
      : `FAIL (insets ${insets.map((i) => i.toFixed(1)).join(' / ')}px, --edge ${String(edge)}px)`

    /*
     * The lens is the fixed frame the strip slides under. Every arrow press has
     * to move the world and leave the frame exactly where it was — the whole
     * point of the design, and only a screen rect can tell you it happened.
     */
    const lensEl = (): HTMLElement | null =>
      overlay()?.querySelector<HTMLElement>('.overview__viewport') ?? null
    const lensCentre = (): number => {
      const box = lensEl()?.getBoundingClientRect()
      return box === undefined ? Number.NaN : box.left + box.width / 2
    }
    const restingLens = lensCentre()
    let moves = 0
    let drift = 0
    for (let i = 0; i < 4; i++) {
      const before = map.getBoundingClientRect().left
      press('ArrowRight')
      if (Math.abs(map.getBoundingClientRect().left - before) > 1) moves += 1
      drift = Math.max(drift, Math.abs(lensCentre() - restingLens))
    }
    report['overviewArrowsSlideTheStrip'] =
      moves === 4
        ? `ok (4 presses, 4 moves, lens drift ${drift.toFixed(1)}px)`
        : `FAIL (${String(moves)} of 4 presses moved the strip)`
    /*
     * With the strip slid over, a card crosses the host's left edge. Nothing of
     * it may paint inside the band: probe the middle of those 6px and see what
     * is actually on top there.
     */
    const boxes = [...overlay()!.querySelectorAll<HTMLElement>('.overview__card')].map((el) =>
      el.getBoundingClientRect(),
    )
    // Whichever edge the strip actually runs past — either proves the cut.
    const cut = [
      { at: hostBox.left + edge / 2, side: 'left', b: boxes.find((b) => b.left < hostBox.left + edge && b.right > hostBox.left + edge) },
      { at: hostBox.right - edge / 2, side: 'right', b: boxes.find((b) => b.right > hostBox.right - edge && b.left < hostBox.right - edge) },
    ].find((c) => c.b !== undefined)
    if (cut?.b === undefined) {
      report['overviewStripIsClipped'] = 'skipped: the strip reaches neither edge'
    } else {
      const hit = document.elementFromPoint(cut.at, cut.b.top + cut.b.height / 2)
      const painted = hit?.closest('.overview__card') ?? null
      report['overviewStripIsClipped'] =
        painted === null
          ? `ok (${cut.side} band holds ${hit?.className ?? 'nothing'}, no card)`
          : `FAIL (a card paints into the ${cut.side} band)`
    }

    report['overviewLensHoldsStill'] =
      drift < 1
        ? `ok (centre ${String(Math.round(restingLens))}px, drift ${drift.toFixed(1)}px)`
        : `FAIL (lens moved ${drift.toFixed(1)}px)`

    /*
     * A background pane ringing repaints the open map, and a repaint must not
     * drag it back to the focused card. Only a live pty can ring, and the check
     * window is otherwise silent — which is why this reached a user first.
     */
    const walked = selected()
    const noisy = addedIds.find((id) => id !== focusedId() && id !== walked)
    if (noisy === undefined) {
      report['overviewPanSurvivesRepaint'] = 'skipped: no spare background pane to ring'
    } else {
      const marked = (): boolean =>
        (overlay()?.querySelector(
          `.overview__card[data-pane-id="${noisy}"].overview__card--wants`,
        ) ?? null) !== null
      // Re-baselined: the wheel and the sidebar above both moved the map.
      const settled = map.getBoundingClientRect().left
      api.write(noisy, `printf '\\a'\n`)
      // The mark is the proof a repaint ran; without it there is nothing to assert.
      const repainted = await waitFor(marked)
      const held = map.getBoundingClientRect().left
      report['overviewPanSurvivesRepaint'] = !repainted
        ? 'skipped: the background pane never rang'
        : Math.abs(held - settled) < 1 && selected() === walked
          ? `ok (map held at ${String(Math.round(held))}px)`
          : `FAIL (map ${String(Math.round(settled))} → ${String(Math.round(held))}px, selection ${String(walked)} → ${String(selected())})`
    }
    /*
     * The wheel must pan the map. The canvas claims wheel events in capture and
     * stops propagation, so the map's own listener never ran and the map sat
     * still — invisible to every unit test, since the two listeners only meet
     * on a real event path.
     */
    const beforeWheel = map.getBoundingClientRect().left
    const lensBeforeWheel = lensCentre()
    const canvasBeforeWheel = canvasScroll()
    wheel(overlay(), 0, -400)
    const afterWheel = map.getBoundingClientRect().left
    const lensDrift = Math.abs(lensCentre() - lensBeforeWheel)
    report['overviewWheelPans'] =
      afterWheel > beforeWheel + 1 && lensDrift < 1
        ? `ok (map ${String(Math.round(beforeWheel))} → ${String(Math.round(afterWheel))}px, lens held)`
        : `FAIL (wheel moved the map ${String(Math.round(afterWheel - beforeWheel))}px, lens drifted ${lensDrift.toFixed(1)}px)`

    /*
     * The session behind the scrim follows the lens as it is scrubbed, and
     * leaving without landing puts it back: cancel means nothing moved.
     */
    // Baselined at the wheel itself: the arrow snaps above scrub too, and
    // measuring from the opening position would pass on their work alone.
    const scrubbedTo = await waitFor(() => canvasScroll() !== canvasBeforeWheel)
    report['overviewScrubMovesTheCanvas'] = scrubbedTo
      ? `ok (canvas ${String(Math.round(canvasBeforeWheel))} → ${String(Math.round(canvasScroll()))}px on one wheel)`
      : `FAIL (canvas stuck at ${String(Math.round(canvasBeforeWheel))}px while the strip moved)`

    press('Escape')
    await waitFor(() => overlay() === null)
    const restored = await waitFor(() => Math.abs(canvasScroll() - openedScroll) <= 2)
    report['overviewCancelRestoresTheCanvas'] = restored
      ? `ok (back at ${String(Math.round(canvasScroll()))}px)`
      : `FAIL (canvas left at ${String(Math.round(canvasScroll()))}px, opened at ${String(Math.round(openedScroll))}px)`

    // Reopen for the checks below; the strip aligns from the canvas again.
    press('KeyM', { altKey: true })
    await waitFor(() => overlay() !== null)

    /*
     * The map is drawn to the viewport, so the sidebar collapsing under it must
     * re-lay it out. Assert the map's own width: the marker is no proof, since
     * syncViewport redraws that alone on every canvas scroll.
     */
    const mapStyled = (): number =>
      Number.parseFloat(
        overlay()?.querySelector<HTMLElement>('.overview__map')?.style.width ?? '0',
      )
    const styledBefore = mapStyled()
    const widthBefore = host.clientWidth
    press('KeyS', { altKey: true })
    const widened = await waitFor(() => host.clientWidth !== widthBefore)
    /*
     * The map only changes width if the wider room lifts the scale off the
     * floor. In a small window the floor pins it at both widths, and there is
     * nothing a re-render could change — unmeasurable, not broken.
     */
    const liftsOffTheFloor = (): boolean =>
      (host.clientWidth - 96) / canvasSpan() > MIN_OVERVIEW_COLUMN_PX / narrowest
    if (!widened) {
      report['overviewFollowsSidebar'] = 'skipped: the sidebar did not move'
    } else if (!liftsOffTheFloor()) {
      report['overviewFollowsSidebar'] =
        `skipped: the floor pins the scale at ${String(widthBefore)} and ${String(host.clientWidth)}px alike`
      press('KeyS', { altKey: true })
      await waitFor(() => host.clientWidth === widthBefore)
    } else {
      const relaidOut = await waitFor(() => mapStyled() !== styledBefore)
      report['overviewFollowsSidebar'] = relaidOut
        ? `ok (map ${String(Math.round(styledBefore))} → ${String(Math.round(mapStyled()))}px for host ${String(widthBefore)} → ${String(host.clientWidth)}px)`
        : `FAIL (map stuck at ${String(Math.round(styledBefore))}px while the host went ${String(widthBefore)} → ${String(host.clientWidth)}px)`
      press('KeyS', { altKey: true })
      // Wait for the map too: the host is back a frame before the map redraws,
      // and the next check would read that half-way state as a stray move.
      await waitFor(() => host.clientWidth === widthBefore && mapStyled() === styledBefore)
    }

    /*
     * Enter lands: the canvas must end up showing exactly the region the lens
     * framed, not wherever revealing the pane would have gone. Read the scroll
     * off the track's own transform — the number the user actually sees.
     */
    // The scale, straight off the drawing: one card against its own pane.
    const target = selected() ?? ''
    const cardBox = overlay()?.querySelector<HTMLElement>(
      `.overview__card[data-pane-id="${target}"]`,
    )
    const paneEl = visiblePanes().find((p) => p.dataset['paneId'] === target)
    const drawnScale =
      cardBox === null || cardBox === undefined || paneEl === undefined
        ? 0
        : Number.parseFloat(cardBox.style.width) / Number.parseFloat(paneEl.style.width)
    const lensOnStripPx = Number.parseFloat(lensEl()?.style.left ?? 'NaN')
    if (drawnScale <= 0 || Number.isNaN(lensOnStripPx)) {
      report['overviewEnterLands'] = 'skipped: could not measure the strip'
      press('Escape')
      await waitFor(() => overlay() === null)
    } else {
      const wanted = Math.min(
        Math.max(0, lensOnStripPx / drawnScale),
        Math.max(0, canvasSpan() - host.clientWidth),
      )
      press('Enter')
      await waitFor(() => overlay() === null)
      const landed = await waitFor(() => Math.abs(canvasScroll() - wanted) <= 2)
      report['overviewEnterLands'] = landed
        ? `ok (canvas at ${String(Math.round(canvasScroll()))}px, lens framed ${String(Math.round(wanted))}px)`
        : `FAIL (canvas at ${String(Math.round(canvasScroll()))}px, lens framed ${String(Math.round(wanted))}px)`
    }
  }

  if (overlay() !== null) {
    press('Escape')
    await waitFor(() => overlay() === null)
  }
  await undo()
}

/**
 * The standard signals a program sends: the bell and OSC 0/2.
 *
 * Only reachable through a live pty. The sequences are written by the shell in
 * an unfocused pane, which is the case that matters — main watches the pty
 * directly so a frozen pane still reports.
 */
export async function checkTerminalSignals(report: Report): Promise<void> {
  const startFocus = focusedId()
  const target = visiblePanes()
    .map((p) => p.dataset['paneId'] ?? '')
    .find((id) => id !== '' && id !== startFocus)
  if (target === undefined) {
    report['signalsNeedASecondPane'] = 'skipped: only one pane on screen'
    return
  }

  const dot = (): HTMLElement | null =>
    document.querySelector<HTMLElement>(`.sidebar__row--current .sidebar__dot`)
  const dotColor = (): string => (dot() === null ? '' : getComputedStyle(dot()!).backgroundColor)

  const runningColor = dotColor()
  if (runningColor === '') {
    report['signalsNeedTheSidebar'] = 'skipped: session list not on screen'
    return
  }

  // Written as shell input, so this is the real path: shell -> pty -> main.
  api.write(target, `printf '\\033]2;selfcheck-title\\a'\n`)
  api.write(target, `printf '\\a'\n`)

  const rang = await waitFor(() => dotColor() !== runningColor)
  report['bellMarksTheSession'] = rang
    ? `ok (${runningColor} -> ${dotColor()})`
    : `FAIL (dot stayed ${runningColor})`

  // The card for that pane must stand out from the panes that stayed quiet.
  press('KeyM', { altKey: true })
  await waitFor(() => overlay() !== null)
  const card = (id: string): HTMLElement | null =>
    overlay()?.querySelector<HTMLElement>(`.overview__card[data-pane-id="${id}"]`) ?? null

  if (card(target) === null) {
    report['bellMarksTheCard'] = 'FAIL (no card for the pane that rang)'
  } else {
    const rangBorder = getComputedStyle(card(target)!).borderTopColor
    const quiet = [...overlay()!.querySelectorAll<HTMLElement>('.overview__card')].find(
      (el) => el.dataset['paneId'] !== target,
    )
    const quietBorder = quiet === undefined ? '' : getComputedStyle(quiet).borderTopColor
    report['bellMarksTheCard'] =
      quietBorder !== '' && rangBorder !== quietBorder
        ? `ok (${rangBorder} vs ${quietBorder})`
        : `FAIL (rang ${rangBorder}, quiet ${quietBorder})`
  }

  // OSC 2 rode the same path; the overview reads it back through main.
  const reported = (): string =>
    card(target)?.querySelector<HTMLElement>('.overview__reported')?.textContent ?? ''
  const titled = await waitFor(() => reported() === 'selfcheck-title')
  report['titleReachesTheOverview'] = titled ? 'ok' : `FAIL (read "${reported()}")`

  press('Escape')
  await waitFor(() => overlay() === null)

  // Looking at the pane is what dismisses it — nothing else does.
  document
    .querySelector(`[data-pane-id="${target}"]`)
    ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  const cleared = await waitFor(() => focusedId() === target && dotColor() === runningColor)
  report['lookingClearsTheMark'] = cleared ? 'ok' : `FAIL (dot ${dotColor()})`

  // Put focus back where the check found it.
  document
    .querySelector(`[data-pane-id="${startFocus ?? ''}"]`)
    ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await waitFor(() => focusedId() === startFocus)
  report['signalsUndone'] = focusedId() === startFocus ? 'ok' : 'FAIL (focus not restored)'

  /*
   * OSC 777 travels the same path as the bell but is also the one that reaches
   * the desktop. This window has no focus, so a notification should appear on
   * screen while the check runs — the app-side mark is what is asserted here.
   */
  api.write(target, `printf '\\033]777;notify;selfcheck;osc 777 arrived\\a'\n`)
  const notified = await waitFor(() => dotColor() !== runningColor)
  report['osc777MarksTheSession'] = notified
    ? `ok (${dotColor()})`
    : `FAIL (dot stayed ${runningColor})`

  document
    .querySelector(`[data-pane-id="${target}"]`)
    ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await waitFor(() => dotColor() === runningColor)
  document
    .querySelector(`[data-pane-id="${startFocus ?? ''}"]`)
    ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await waitFor(() => focusedId() === startFocus)
}


/*
 * A URL printed by a program has to become a link.
 *
 * Nothing about it is in the DOM: the addon decides which cells the link covers
 * and the renderer draws the underline onto a canvas. So hover the text and
 * measure the range the link reports, in the pane's own pixels.
 */
export async function checkClickableLinks(report: Report): Promise<void> {
  const pane = document.querySelector<HTMLElement>('.session-host:not([hidden]) .pane--focused')
  const host = pane?.querySelector<HTMLElement>('.terminal-host') ?? null
  const term = termOf(host)
  const screen = host?.querySelector<HTMLElement>('.xterm-screen') ?? null
  if (pane === null || term === undefined || host === null || screen === null) {
    report['linkHover'] = 'FAIL (no focused terminal)'
    return
  }

  const url = 'https://example.com/termspace-link'
  // Straight into the buffer: the pty stays out of it, and no browser is opened.
  await new Promise<void>((resolve) => term.write(`\r\n${url}\r\n`, resolve))
  // The write left the cursor on the line below the URL.
  const row = term.buffer.active.cursorY - 1

  const rect = screen.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0 || row < 0) {
    // A pane that is not being drawn cannot be pointed at.
    report['linkHover'] = 'skipped: terminal not drawn, nothing to point at'
    return
  }
  const cellWidth = rect.width / term.cols
  const cellHeight = rect.height / term.rows

  // Aim at the middle of the third character, well inside the URL.
  const hoverAt = (offsetCells: number): void => {
    screen.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: rect.left + cellWidth * (offsetCells + 0.5),
        clientY: rect.top + cellHeight * (row + 0.5),
      }),
    )
  }
  const link = (): ReturnType<typeof hoveredLinkOf> => hoveredLinkOf(host)
  // Re-point each round: the linkifier only asks when the cell under it moves.
  await waitFor(() => {
    hoverAt(link() === null ? 2 : 3)
    return link()?.text === url
  }, 6000)

  const hovered = link()
  if (hovered === null || hovered.text !== url) {
    report['linkHover'] = `skipped: no hover state (${hovered === null ? 'none' : hovered.text})`
    return
  }
  report['linkHover'] = `ok (${hovered.text})`

  const cells = hovered.range.end.x - hovered.range.start.x + 1
  const left = rect.left + (hovered.range.start.x - 1) * cellWidth
  const width = cells * cellWidth
  const paneRect = pane.getBoundingClientRect()
  const inside = left >= paneRect.left - 1 && left + width <= paneRect.right + 1
  report['linkUnderlineRange'] =
    width > 0 && inside
      ? `ok (${cells} cells, ${width.toFixed(0)}px)`
      : `FAIL (${width.toFixed(0)}px at ${left.toFixed(0)}, pane ${paneRect.left.toFixed(0)}–${paneRect.right.toFixed(0)})`
  // The pointer cursor is xterm's own sign that it treats these cells as a link.
  report['linkPointerCursor'] = screen.classList.contains('xterm-cursor-pointer')
    ? 'ok'
    : 'note: no pointer cursor class while hovering'

  // Leave the hover behind, so the next check finds an ordinary pane.
  screen.dispatchEvent(
    new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + 1, clientY: rect.bottom - 1 }),
  )
}
