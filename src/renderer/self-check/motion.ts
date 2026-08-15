import { api } from '../api'
import { CANVAS_EDGE } from '../layout-geometry'
import {
  animationRuns,
  focusedHost,
  focusedId,
  holdsStill,
  panes,
  press,
  type Report,
  SKIPPED,
  sleep,
  termOf,
  trackOffset,
  trackSettles,
  waitFor,
  waitForAsync,
  wheel,
} from './harness'

export async function checkWheelScroll(report: Report): Promise<void> {
  // Without frames there is no inertia, so 0px means unmeasurable, not broken.
  if (!(await animationRuns())) {
    report['wheelChecks'] = SKIPPED
    return
  }
  const host = document.querySelector<HTMLElement>('.session-host:not([hidden])')
  if (host === null) {
    report['wheelScroll'] = 'FAIL (no session host)'
    return
  }
  const roll = (deltaY: number): void => {
    wheel(host, 0, deltaY)
  }
  /** Wait for the glide to settle, then measure the distance. */
  const settle = async (): Promise<number> => Math.abs(await trackSettles())

  // Earlier checks may have parked at the right edge, where nothing can move.
  roll(-100_000)
  await settle()

  // Distance per notch. Without boost this would be the raw 100px.
  const before = Math.abs(trackOffset())
  roll(100)
  const single = (await settle()) - before
  report['wheelSingleNotch'] =
    single > 250 ? `ok (${Math.round(single)}px)` : `TOO SLOW (${Math.round(single)}px)`

  // Rolling fast must cover more per notch.
  const burstStart = Math.abs(trackOffset())
  for (let i = 0; i < 5; i++) {
    roll(100)
    // Input pacing, not a wait: the boost is read off the gap between notches.
    await sleep(40)
  }
  const burst = (await settle()) - burstStart
  const perNotch = burst / 5
  report['wheelBurstPerNotch'] =
    perNotch > single ? `ok (${Math.round(perNotch)}px vs ${Math.round(single)}px single)` : `NO ACCEL (${Math.round(perNotch)}px)`

  // Reverse must work too.
  roll(-100)
  await settle()
  report['wheelReverses'] = Math.abs(trackOffset()) < burstStart + burst ? 'ok' : 'FAIL'

  // Vertical wheel over a terminal belongs to its scrollback.
  const body = document.querySelector<HTMLElement>('.pane--focused .pane__body')
  if (body === null) {
    report['verticalWheelStaysInTerminal'] = 'FAIL (no pane body)'
    return
  }
  const beforeVertical = trackOffset()
  wheel(body, 0, 400)
  // Give a canvas that should not move every chance to move.
  await trackSettles()
  report['verticalWheelStaysInTerminal'] =
    trackOffset() === beforeVertical
      ? 'ok (canvas stayed put)'
      : `FAIL (canvas moved ${trackOffset() - beforeVertical}px)`

  /*
   * Vertical wheel must actually move the scrollback, and accelerate.
   * "The canvas didn't move" alone also passes when nothing moved at all.
   */
  const termHost = focusedHost()
  const scrolled = (): number => termOf(termHost)?.buffer.active.viewportY ?? -1

  // Produce more output than fits, so there is something to scroll.
  api.write(focusedId() ?? '', 'seq 1 400\n')
  // Scrollback exists once the viewport has been pushed off the top of it.
  await waitFor(() => scrolled() > 0, 8000)

  /*
   * Dispatch inside the terminal. The listener sits on a descendant, and an
   * event started at the parent never travels down to it.
   */
  const wheelTarget = termHost?.querySelector<HTMLElement>('.xterm-screen') ?? termHost
  const wheelOverTerminal = (deltaY: number): void => {
    wheel(wheelTarget, 0, deltaY)
  }

  const bottom = scrolled()
  wheelOverTerminal(-120) // upwards
  await waitFor(() => scrolled() < bottom, 2000)
  const afterOne = scrolled()
  report['terminalWheelScrolls'] =
    afterOne < bottom ? `ok (${String(bottom)} → ${String(afterOne)} lines)` : `FAIL (unchanged at ${String(bottom)})`

  // Same physics as the canvas: continuous rolling covers more per notch.
  const singleStep = bottom - afterOne
  const burstStartLine = scrolled()
  for (let i = 0; i < 5; i++) {
    wheelOverTerminal(-120)
    // Input pacing again: rolling is only continuous if the notches are.
    await sleep(30)
  }
  await holdsStill(scrolled, 3000)
  const perNotchLine = (burstStartLine - scrolled()) / 5
  report['terminalWheelAccelerates'] =
    perNotchLine > singleStep
      ? `ok (${perNotchLine.toFixed(1)} vs ${String(singleStep)} lines single)`
      : `NO ACCEL (${perNotchLine.toFixed(1)} vs ${String(singleStep)} lines single)`

  /*
   * The strip around the title slides the canvas.
   *
   * A mouse has no horizontal wheel, and the seams between panels are 6px, so
   * this is the only target always within reach. It has to opt out of the
   * window drag region: the window manager hit tests a drag surface as the
   * title bar and the page never sees the wheel.
   */
  const panStrip = document.querySelector<HTMLElement>('.app-bar__pan')
  report['titleStripNoDrag'] =
    panStrip !== null && getComputedStyle(panStrip).getPropertyValue('-webkit-app-region') === 'no-drag'
      ? 'ok'
      : `FAIL (${String(panStrip === null ? 'missing' : getComputedStyle(panStrip).getPropertyValue('-webkit-app-region'))})`

  // Start from the left edge; at the right limit nothing can move and the
  // check would read "the strip does nothing".
  roll(-100_000)
  await settle()
  const beforeBar = trackOffset()
  wheel(panStrip, 0, 300)
  await settle()
  report['titleBarPans'] =
    trackOffset() !== beforeBar
      ? `ok (${String(beforeBar)} → ${String(trackOffset())}px)`
      : 'FAIL (the strip did not move the canvas)'

  /*
   * The canvas scrollbar is on whenever the canvas overflows, not only while
   * scrolling. It is the only thing saying more exists off screen.
   */
  // At the left limit, so the inset below is the rail's own and not the thumb's.
  roll(-100_000)
  await settle()
  const bar = document.querySelector<HTMLElement>('.scroll-indicator')
  const barBox = bar?.getBoundingClientRect()
  const canvasBox = document
    .querySelector<HTMLElement>('.session-host:not([hidden])')
    ?.getBoundingClientRect()
  report['scrollBarShown'] = bar !== null && !bar.hidden ? 'ok' : `FAIL (hidden=${String(bar?.hidden)})`
  report['scrollBarSized'] =
    barBox !== undefined && canvasBox !== undefined && barBox.width > 0 && barBox.width < canvasBox.width
      ? `ok (${String(Math.round(barBox.width))} of ${String(Math.round(canvasBox.width))}px)`
      : `FAIL (${String(barBox?.width)})`
  /*
   * The bar sits the same distance from the panes as the panes sit from each
   * other. Anything wider reads as a stray band across the top.
   */
  const appBarBox = document.querySelector<HTMLElement>('.app-bar')?.getBoundingClientRect()
  const stripBox = document.querySelector<HTMLElement>('.app-bar__pan')?.getBoundingClientRect()
  /*
   * The highest pane, not the first in the DOM: panes are placed absolutely and
   * keep their creation order, so after a move or a close the first element is
   * not the one nearest the bar.
   */
  const topPane = [...document.querySelectorAll<HTMLElement>('.session-host:not([hidden]) .pane')]
    .map((pane) => pane.getBoundingClientRect())
    .sort((a, b) => a.top - b.top)[0]
  if (appBarBox !== undefined && stripBox !== undefined && topPane !== undefined) {
    const stripGap = topPane.top - stripBox.bottom
    report['barToPaneGap'] = `${(topPane.top - appBarBox.bottom).toFixed(1)}px`
    report['stripToPaneGap'] = `${stripGap.toFixed(1)}px`
    report['barGapMatchesPaneGap'] =
      Math.abs(stripGap - CANVAS_EDGE) <= 1
        ? 'ok'
        : `FAIL (${stripGap.toFixed(1)}px vs ${String(CANVAS_EDGE)}px between panes)`
  }

  /*
   * It runs between the pane edges, not the whole canvas. Reaching into the
   * 6px seam puts it against the sidebar, which reads as belonging to neither.
   */
  const paneBox = document
    .querySelector<HTMLElement>('.session-host:not([hidden]) .pane')
    ?.getBoundingClientRect()
  report['scrollBarInsideCanvas'] =
    barBox !== undefined && canvasBox !== undefined && paneBox !== undefined
      ? Math.abs(barBox.left - (canvasBox.left + CANVAS_EDGE)) <= 1 &&
        barBox.right <= canvasBox.right - CANVAS_EDGE + 1
        ? `ok (inset ${(barBox.left - canvasBox.left).toFixed(1)}px)`
        : `FAIL (bar ${String(Math.round(barBox.left))}..${String(Math.round(barBox.right))} vs canvas ${String(Math.round(canvasBox.left))}..${String(Math.round(canvasBox.right))})`
      : 'skipped (no pane on screen)'

  /*
   * The bar is a thumb, not a readout: dragging it moves the canvas, and the
   * canvas goes the same way the thumb does. Grabbing it a few pixels below its
   * own top proves the hit area reaches past the 5px that is drawn.
   */
  if (bar === null || barBox === undefined || bar.hidden) {
    report['scrollBarDrags'] = 'skipped (nothing to scroll)'
  } else {
    const before = trackOffset()
    const at = { pointerId: 2, bubbles: true, cancelable: true, clientY: barBox.top + 3 }
    bar.dispatchEvent(new PointerEvent('pointerdown', { ...at, clientX: barBox.left + 2 }))
    bar.dispatchEvent(new PointerEvent('pointermove', { ...at, clientX: barBox.left + 60 }))
    bar.dispatchEvent(new PointerEvent('pointerup', { ...at, clientX: barBox.left + 60 }))
    await trackSettles()
    // The track slides the opposite way to the content it carries.
    const moved = before - trackOffset()
    report['scrollBarDrags'] =
      moved > 0 ? `ok (${String(Math.round(moved))}px right)` : `FAIL (canvas moved ${String(moved)}px)`
    roll(-100_000)
    await settle()
  }

  // Nor may it touch the outline of the pane above it.
  const bottomPane = Array.from(
    document.querySelectorAll<HTMLElement>('.session-host:not([hidden]) .pane'),
  ).reduce<DOMRect | null>((lowest, pane) => {
    const box = pane.getBoundingClientRect()
    return lowest === null || box.bottom > lowest.bottom ? box : lowest
  }, null)
  report['scrollBarClearsPane'] =
    barBox !== undefined && bottomPane !== null
      ? barBox.top - bottomPane.bottom >= 2
        ? `ok (${(barBox.top - bottomPane.bottom).toFixed(1)}px clear)`
        : `FAIL (${(barBox.top - bottomPane.bottom).toFixed(1)}px from the pane outline)`
      : 'skipped (no pane on screen)'

  // A horizontal component hands the wheel to the canvas.
  roll(-100_000)
  await settle()
  const beforeHorizontal = trackOffset()
  wheel(body, 300, 0)
  // Wait for movement itself; settling would return before anything started.
  const moved = await waitFor(() => trackOffset() !== beforeHorizontal, 2400)
  report['horizontalWheelMovesCanvas'] = moved ? 'ok' : 'FAIL (the canvas did not move)'

  // Frames may have stopped mid-check, which invalidates everything above.
  if (!(await animationRuns())) {
    for (const key of [
      'wheelSingleNotch',
      'wheelBurstPerNotch',
      'wheelReverses',
      'verticalWheelStaysInTerminal',
      'horizontalWheelMovesCanvas',
    ]) {
      report[key] = SKIPPED
    }
  }

  // The focused pane must stay awake even when scrolled out of view.
  roll(100_000)
  await settle()
  report['focusedPaneNeverFreezes'] =
    document.querySelector('.pane--focused.pane--frozen') === null
      ? 'ok'
      : 'FAIL (the focused pane froze)'
  // Scroll away and back: a thawed pane has to repaint.
  roll(100_000)
  await settle()
  roll(-100_000)
  await settle()

  /*
   * A frozen pane in view renders as an empty box, which reads as a dead
   * terminal. The active region is three viewports wide, so this must hold.
   */
  const blankInView = (): HTMLElement[] => {
    const viewLeft = -trackOffset()
    const viewRight = viewLeft + host.clientWidth
    return panes().filter((pane) => {
      if (!pane.classList.contains('pane--frozen')) return false
      const left = Number.parseInt(pane.style.left || '0')
      const right = left + Number.parseInt(pane.style.width || '0')
      return right > viewLeft && left < viewRight
    })
  }
  // Thawing is a repaint, not an instant: wait for it before counting.
  await waitFor(() => blankInView().length === 0, 2000)
  report['noFrozenPaneInView'] =
    blankInView().length === 0
      ? 'ok'
      : `FAIL (${blankInView().length} frozen panes in view)`
}

/**
 * Getting back to the focused pane after wheeling away from it.
 *
 * Measured in viewport pixels rather than scroll numbers: the pane is only
 * really back when its box is inside the host's box.
 */
export async function checkRevealFocus(report: Report): Promise<void> {
  if (!(await animationRuns())) {
    report['revealFocusChecks'] = SKIPPED
    return
  }
  const host = document.querySelector<HTMLElement>('.session-host:not([hidden])')
  const focusedPane = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('.session-host:not([hidden]) .pane--focused')
  if (host === null || focusedPane() === null) {
    report['revealFocus'] = 'FAIL (no focused pane)'
    return
  }

  /*
   * A pane wider than the window can never fit; there the left edge is all the
   * reveal promises, and the check must ask for no more (the groups run side by
   * side in narrow windows, where this is the normal case).
   */
  const inView = (): boolean => {
    const pane = focusedPane()
    if (pane === null) return false
    const box = pane.getBoundingClientRect()
    const view = host.getBoundingClientRect()
    if (box.left < view.left - 1) return false
    return box.right <= view.right + 1 || box.width >= view.width
  }

  /**
   * Wheel the canvas until the focused pane is off screen and the glide is over.
   *
   * Waiting only for the pane to leave is not enough: inertia is still running,
   * and a later reading would move on its own with nothing having touched it.
   */
  const scrollAway = async (): Promise<boolean> => {
    wheel(host, 0, 100_000)
    if (!(await waitFor(() => !inView(), 3000))) return false
    await trackSettles()
    return !inView()
  }

  if (!(await scrollAway())) {
    // A canvas no wider than the window has nowhere to hide the pane.
    report['revealFocusChecks'] = SKIPPED
    return
  }
  press('KeyG', { altKey: true })
  // Revealing is a glide, so it needs frames the whole way — a window occluded
  // after the gate above cannot show anything, which is not a failure.
  report['altGRevealsFocusedPane'] = (await waitFor(inView, 2000))
    ? 'ok'
    : (await animationRuns())
      ? 'FAIL (Alt+G left the focused pane off screen)'
      : SKIPPED

  if (!(await scrollAway())) {
    report['revealFocusChecks'] = SKIPPED
    return
  }
  const pane = focusedPane()!
  const at = { clientX: 200, clientY: 200, bubbles: true, cancelable: true }
  pane.dispatchEvent(new MouseEvent('mousedown', at))
  pane.dispatchEvent(new MouseEvent('mouseup', at))
  report['clickRevealsFocusedPane'] = (await waitFor(inView, 2000))
    ? 'ok'
    : (await animationRuns())
      ? 'FAIL (clicking the focused pane did not bring it back)'
      : SKIPPED

  // A drag is a text selection, not a request to move the canvas.
  if (!(await scrollAway())) return
  const before = trackOffset()
  pane.dispatchEvent(new MouseEvent('mousedown', { ...at, clientX: 200 }))
  pane.dispatchEvent(new MouseEvent('mouseup', { ...at, clientX: 320 }))
  // Give a canvas that must not move the time it would need to move.
  await trackSettles()
  report['dragOnFocusedPaneHoldsStill'] =
    trackOffset() === before ? 'ok' : `FAIL (canvas moved ${trackOffset() - before}px mid-drag)`

  /*
   * Moving the pane keeps focus on it, so nothing else brings the view along:
   * a pane sent rightwards would otherwise walk off screen and be lost.
   *
   * Two presses right take it out into a column of its own and then into the
   * next one; two back undo exactly that, which is what leaves the layout as
   * the next check expects to find it.
   */
  const paneLeft = (): number => focusedPane()?.getBoundingClientRect().left ?? 0
  for (let i = 0; i < 2; i++) {
    const was = paneLeft()
    press('KeyP', { altKey: true, shiftKey: true })
    await waitFor(() => paneLeft() !== was, 2000)
  }
  // The move lands a frame before the view follows it; the glide is the point.
  await waitFor(inView, 2000)
  report['movingAPaneBringsTheViewAlong'] = inView()
    ? 'ok'
    : (await animationRuns())
      ? 'FAIL (the moved pane was left off screen)'
      : SKIPPED
  for (let i = 0; i < 2; i++) {
    const was = paneLeft()
    press('KeyU', { altKey: true, shiftKey: true })
    await waitFor(() => paneLeft() !== was, 2000)
  }
}

export async function checkClipboard(report: Report, focused: boolean): Promise<void> {
  /*
   * Wayland silently ignores clipboard writes from an inactive window, so
   * without focus this is unmeasurable rather than broken.
   */
  if (!focused) {
    report['clipboardChecks'] = 'skipped: no focus, clipboard unmeasurable'
    return
  }

  // Restore the user's clipboard at the end.
  const original = await api.readClipboard()

  // IPC round trip — a different path from selection extraction.
  const roundTrip = `ROUNDTRIP_${String(performance.now())}`
  // Shared resource: a clipboard manager or the user can win a race, so retry.
  let echoed = ''
  await waitForAsync(
    async () => {
      api.writeClipboard(roundTrip)
      echoed = await api.readClipboard()
      return echoed === roundTrip
    },
    2000,
    350,
  )
  report['clipboardRoundTrip'] = echoed === roundTrip ? 'ok' : 'FAIL'

  // Synthetic drags can't select on a canvas, so reach xterm through the dev seam.
  const marker = 'CLIPBOARD_CHECK_MARKER'
  api.write(focusedId() ?? '', `printf '%s\\n' "${marker}"\n`)

  const hostEl = focusedHost()
  const term = termOf(hostEl)
  if (term === undefined) {
    report['clipboardCopy'] = 'FAIL (could not reach the terminal instance)'
    api.writeClipboard(original)
    return
  }

  // Wait for the marker to appear rather than a fixed delay — shell startup varies.
  const selection = (): string => {
    term.selectAll()
    return term.getSelection()
  }
  const printed = await waitFor(() => selection().includes(marker), 6000)
  if (!printed) {
    report['clipboardCopy'] = 'FAIL (marker never appeared; the shell did not start)'
    api.writeClipboard(original)
    return
  }
  // Copy what the shell has finished writing, not half a line of it.
  await holdsStill(() => selection().length, 2000)

  press('KeyC', { ctrlKey: true, shiftKey: true })
  let clip = ''
  await waitForAsync(async () => (clip = await api.readClipboard()).includes(marker), 2000, 150)
  report['clipboardCopy'] = clip.includes(marker)
    ? 'ok'
    : `FAIL (marker not in clipboard: ${JSON.stringify(clip.slice(0, 40))})`

  // Copy-on-select: releasing the button alone must reach the clipboard.
  api.writeClipboard('COPY_ON_SELECT_NOT_YET')
  await waitForAsync(async () => (await api.readClipboard()).startsWith('COPY_ON_SELECT'), 2000, 150)
  term.selectAll()
  hostEl?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  let afterSelect = ''
  await waitForAsync(
    async () => (afterSelect = await api.readClipboard()).includes(marker),
    2000,
    150,
  )
  report['copyOnSelect'] = afterSelect.includes(marker)
    ? 'ok'
    : `FAIL (clipboard unchanged after selecting: ${JSON.stringify(afterSelect.slice(0, 40))})`

  api.writeClipboard(original)
}
