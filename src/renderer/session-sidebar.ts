/**
 * The resident session list.
 *
 * Not a modal. This app turns switching into moving, and a list that covers
 * the screen and vanishes would break that at the list layer.
 *
 * It also shows which sessions are alive — several hold their own ptys at
 * once, and that is invisible otherwise.
 */
import type { SessionSummary } from '../shared/protocol'
import { t } from './i18n'
import { IS_MAC } from './platform'
import {
  dropTargetAt,
  isRestoreDrop,
  REORDER_THRESHOLD,
  rowShift,
  type RowBox,
} from './sidebar-reorder'
import { createWheelDetent } from './wheel-detent'

/** Wheel silence that counts as "arrived": the previewed session opens. */
export const WHEEL_SETTLE_MS = 200

export interface SidebarHooks {
  readonly onOpen: (id: string) => void
  /** End a running session and its ptys. */
  readonly onClose: (id: string) => void
  readonly onRefresh: () => void
  readonly onWidthChange: (width: number) => void
  /** Create a blank one-pane session. */
  readonly onCreateBlank: () => void
  /**
   * Reports what was right-clicked; the shell decides which commands to offer.
   * An archived row carries none of the live commands, so it is flagged here.
   */
  readonly onContextMenu: (
    at: { x: number; y: number },
    sessionId: string | null,
    archived: boolean,
  ) => void
  /** The user typed a new display name for a session. */
  readonly onRename: (id: string, newName: string) => void
  /** The user dragged a row to a new index. */
  readonly onReorder: (id: string, toIndex: number) => void
  /**
   * The user dropped a row on the archive. The shell decides what that costs —
   * a running session has to end first — so only the id travels.
   */
  readonly onArchive: (id: string) => void
  /**
   * The user dragged an archived row back out onto the list. Where it lands is
   * main's to say — the end of the list, as the menu's Restore does.
   *
   * A promise that rejects says the session stayed archived: the row it left
   * held over the list goes back to the dock, since no render is coming.
   */
  readonly onRestore: (id: string) => void | Promise<void>
  /** The chord that opens the nth session, which the user can rebind. */
  readonly gotoHint: (index: number) => string
}

export interface SessionSidebar {
  readonly element: HTMLElement
  /**
   * live: pane count per running session — its keys are which sessions run.
   * The file's own count is stale the moment a pane is split, and splits are
   * never written back. current: the one on screen.
   *
   * Archived sessions arrive in the same list, flagged; they are split off into
   * the dock and never reach the dial or the drag.
   */
  render(
    sessions: readonly SessionSummary[],
    live: ReadonlyMap<string, number>,
    current: string | null,
    /** Sessions holding a pane that rang while you were elsewhere. */
    wanting?: ReadonlySet<string>,
  ): void
  /** Turn the row's name into an input, in place. */
  startRename(sessionId: string): void
  setVisible(visible: boolean): void
  setWidth(width: number): void
  readonly visible: boolean
  destroy(): void
}

export const SIDEBAR_MIN_WIDTH = 160
export const SIDEBAR_MAX_WIDTH = 420

function icon(paths: string | readonly string[], size = 14): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of typeof paths === 'string' ? [paths] : paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '1.2')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('fill', 'none')
    svg.append(path)
  }
  return svg
}

const REFRESH_PATH = 'M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5h-2.5'
const PLUS_PATH = 'M8 3.5v9M3.5 8h9'
/* IEC 5009: a broken ring with the line breaking out of the top. */
const POWER_PATH = 'M8 2.6v5'
const POWER_RING = 'M4.2 6.2A4.6 4.6 0 1 0 11.8 6.2'
/* A box with its lid on: the archive. */
const ARCHIVE_PATHS = ['M2.5 3.5h11v2.5h-11z', 'M3.5 6v6.5h9V6', 'M6.5 8.6h3']

export function createSessionSidebar(host: HTMLElement, hooks: SidebarHooks): SessionSidebar {
  const aside = document.createElement('aside')
  // Shares the panel look, but not the .pane class — that means a canvas terminal.
  aside.className = 'panel sidebar'

  const header = document.createElement('header')
  header.className = 'sidebar__header'

  const title = document.createElement('span')
  title.className = 'sidebar__title'
  title.textContent = t.sidebar.title

  const refresh = document.createElement('button')
  refresh.type = 'button'
  refresh.className = 'sidebar__action'
  refresh.title = t.sidebar.refreshList
  refresh.setAttribute('aria-label', t.sidebar.refreshList)
  refresh.append(icon(REFRESH_PATH))
  refresh.addEventListener('click', () => hooks.onRefresh())

  // Always available, unlike the empty-state button.
  const create = document.createElement('button')
  create.type = 'button'
  create.className = 'sidebar__action'
  create.title = t.sidebar.newSession
  create.setAttribute('aria-label', t.sidebar.newSession)
  create.append(icon(PLUS_PATH))
  create.addEventListener('click', () => hooks.onCreateBlank())

  const headerActions = document.createElement('div')
  headerActions.className = 'sidebar__actions'
  headerActions.append(create, refresh)

  header.append(title, headerActions)

  const list = document.createElement('div')
  list.className = 'sidebar__list'

  /*
   * The archive dock: a header pinned under the list, and the archived rows
   * expanding in flow above it. In flow, not over the list, because the list is
   * resident furniture — anything that covers it hides what you came to read.
   */
  const dock = document.createElement('div')
  dock.className = 'sidebar__dock'

  const dockList = document.createElement('div')
  dockList.className = 'sidebar__dock-list'

  const dockCount = document.createElement('span')
  dockCount.className = 'sidebar__dock-count'

  const dockHeader = document.createElement('button')
  dockHeader.type = 'button'
  dockHeader.className = 'sidebar__dock-header'
  const dockLabel = document.createElement('span')
  dockLabel.className = 'sidebar__dock-label'
  dockLabel.textContent = t.sidebar.archive
  dockHeader.append(icon(ARCHIVE_PATHS), dockLabel, dockCount)

  // Runtime only: every start opens with the archive out of the way.
  let dockOpen = false
  function setDockOpen(next: boolean): void {
    dockOpen = next
    dock.classList.toggle('sidebar__dock--open', next)
    dockHeader.setAttribute('aria-expanded', String(next))
    // Scrolling waits for the height to arrive; closing gives it up at once, so
    // no scrollbar can flash over the rows on the way past the cap.
    if (!next) dock.classList.remove('sidebar__dock--settled')
  }
  dockList.addEventListener('transitionend', (event) => {
    if (event.propertyName !== 'max-height') return
    if (dockOpen) dock.classList.add('sidebar__dock--settled')
  })
  setDockOpen(false)
  dockHeader.addEventListener('click', () => setDockOpen(!dockOpen))

  dock.append(dockList, dockHeader)

  // The gap is the resize handle, same rule as between panes.
  const grip = document.createElement('div')
  grip.className = 'sidebar__grip'

  // Over a row or over empty space decides which commands appear.
  aside.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('.sidebar__row')
    hooks.onContextMenu(
      { x: event.clientX, y: event.clientY },
      row?.dataset['sessionId'] ?? null,
      row?.dataset['archived'] !== undefined,
    )
  })

  aside.append(header, list)
  // Before the canvas: CSS places the grid cells, but tab order follows the DOM.
  host.prepend(aside, grip)

  let visible = true
  let width = 220

  // ── Wheel: the list is a session dial ────────────────
  //
  // A wheel click moves a preview highlight one row; the session itself opens
  // only once the wheel rests. Opening spawns ptys, so rows passed through must
  // stay cold. The list never scrolls on its own — the highlight drags it along.
  let shown: readonly SessionSummary[] = []
  let shownRows: readonly HTMLElement[] = []
  let currentId: string | null = null
  let wantingIds: ReadonlySet<string> = new Set()
  let previewIndex: number | null = null
  let settleTimer: number | null = null
  const detent = createWheelDetent()

  function clearPreview(): void {
    if (settleTimer !== null) window.clearTimeout(settleTimer)
    settleTimer = null
    if (previewIndex !== null) shownRows[previewIndex]?.classList.remove('sidebar__row--preview')
    previewIndex = null
  }

  function movePreview(step: -1 | 1): void {
    const from = previewIndex ?? shown.findIndex((s) => s.id === currentId)
    for (let i = from + step; i >= 0 && i < shown.length; i += step) {
      if (shown[i]?.error !== null) continue
      if (previewIndex !== null) shownRows[previewIndex]?.classList.remove('sidebar__row--preview')
      previewIndex = i
      shownRows[i]?.classList.add('sidebar__row--preview')
      shownRows[i]?.scrollIntoView({ block: 'nearest' })
      return
    }
    // Past either end: the dial stops, the current preview stands.
  }

  list.addEventListener(
    'wheel',
    (event) => {
      // Either drag. The wheel ignores pointer capture, so a roll over the list
      // during a drag out of the archive would still turn the dial — and the
      // session it opened would render the held row out from under the pointer.
      if (drag !== null || dockDrag !== null) return
      if (shown.length === 0) return
      event.preventDefault()
      const step = detent.feed(event.deltaY, event.deltaMode, event.timeStamp)
      if (step !== 0) movePreview(step)
      if (previewIndex === null) return
      // Every event pushes the arrival back — inertia tails must not open early.
      if (settleTimer !== null) window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        const target = previewIndex === null ? undefined : shown[previewIndex]
        clearPreview()
        if (target !== undefined && target.id !== currentId) hooks.onOpen(target.id)
      }, WHEEL_SETTLE_MS)
    },
    { passive: false },
  )

  // ── Drag to reorder ──────────────────────────────────
  //
  // A row's click already opens a session, which spawns ptys, so the drag may
  // not borrow it: nothing happens until the pointer has actually travelled.
  let drag: {
    readonly id: string
    readonly fromIndex: number
    readonly startY: number
    readonly row: HTMLElement
    readonly pointerId: number
    moved: boolean
    dropIndex: number
    /** Row positions taken before any row was pushed; a pushed row measures wrong. */
    boxes: readonly RowBox[]
    /** The archive header's box, or null when it is not on screen to aim at. */
    headerBox: RowBox | null
    overArchive: boolean
  } | null = null
  let swallowClick = false
  /** The dock was put on screen for this drag alone, and goes away with it. */
  let dockForDrag = false

  /**
   * An empty archive has no dock at all, so the first session could never be
   * dragged into it. The drag lends it one — measured only after it is in flow,
   * because it takes height from the list it sits under.
   */
  function showDockForDrag(): void {
    if (dock.isConnected) return
    dockForDrag = true
    aside.append(dock)
  }

  function headerBox(): RowBox | null {
    if (!dock.isConnected) return null
    const box = dockHeader.getBoundingClientRect()
    // Nothing laid out (hidden sidebar, headless test): nothing to aim at.
    return box.height === 0 ? null : { top: box.top, height: box.height }
  }

  function rowBoxes(): RowBox[] {
    return shownRows.map((row) => {
      const box = row.getBoundingClientRect()
      return { top: box.top, height: box.height }
    })
  }

  /*
   * A preview of the drop: the other rows step aside at once, leaving the slot
   * the dragged row would take. Transforms only; the DOM order changes when the
   * drop commits, so a cancel leaves nothing to undo.
   */
  function markDrop(index: number): void {
    if (drag === null) return
    const { boxes, fromIndex } = drag
    const dragged = boxes[fromIndex]
    if (dragged === undefined) return
    const next = boxes[fromIndex + 1] ?? boxes[fromIndex - 1]
    const slot = next === undefined ? dragged.height : Math.abs(next.top - dragged.top)
    shownRows.forEach((row, i) => {
      if (i === fromIndex) return
      const shift = rowShift(i, fromIndex, index)
      row.style.transform = shift === 0 ? '' : `translateY(${String(shift * slot)}px)`
    })
  }

  function endDragVisuals(): void {
    if (drag !== null) {
      drag.row.classList.remove('sidebar__row--dragging')
      drag.row.style.transform = ''
    }
    for (const row of shownRows) row.style.transform = ''
    endListDragStyles()
    endDockTarget()
  }

  /** The drag's own list styling: the grab cursor and the hidden scrollbar. */
  function endListDragStyles(): void {
    list.classList.remove('sidebar__list--dragging')
    list.style.removeProperty('--drag-bar-w')
  }

  function endDockTarget(): void {
    dockHeader.classList.remove('sidebar__dock-header--target')
    if (!dockForDrag) return
    dock.remove()
    dockForDrag = false
  }

  const releaseDragPointer = (pointerId: number): void => {
    if (list.hasPointerCapture(pointerId)) list.releasePointerCapture(pointerId)
  }

  function cancelDrag(): void {
    if (drag === null) return
    const { moved, pointerId } = drag
    endDragVisuals()
    // Cleared before the release: losing capture re-enters here.
    drag = null
    releaseDragPointer(pointerId)
    // A drag that got as far as moving must not leave a click behind it.
    swallowClick = moved
  }

  list.addEventListener('pointerdown', (event) => {
    // A second pointer, or a cancel that never produced a click, must not leave
    // the previous drag's visuals or its armed swallow behind.
    cancelDrag()
    swallowClick = false
    if (event.button !== 0) return
    // On mac Ctrl+click is the right click, and it arrives as button 0 — without
    // this it would arm a drag under the context menu it just opened.
    if (IS_MAC && event.ctrlKey) return
    const target = event.target as HTMLElement | null
    if (target === null) return
    // The power button and the rename input keep their own pointer.
    if (target.closest('.sidebar__close, .sidebar__rename') !== null) return
    const row = target.closest<HTMLElement>('.sidebar__row')
    if (row === null) return
    const index = shownRows.indexOf(row)
    const session = shown[index]
    if (session === undefined) return
    drag = {
      id: session.id,
      fromIndex: index,
      startY: event.clientY,
      row,
      pointerId: event.pointerId,
      moved: false,
      dropIndex: index,
      boxes: [],
      headerBox: null,
      overArchive: false,
    }
  })

  list.addEventListener('pointermove', (event) => {
    if (drag === null) return
    if (!drag.moved) {
      if (Math.abs(event.clientY - drag.startY) < REORDER_THRESHOLD) return
      drag.moved = true
      // The wheel dial rebuilds rows; it cannot run under a live drag.
      clearPreview()
      showDockForDrag()
      drag.boxes = rowBoxes()
      drag.headerBox = headerBox()
      drag.row.classList.add('sidebar__row--dragging')
      // Measured before the class hides the bar, which is what makes it 0.
      list.style.setProperty('--drag-bar-w', `${String(list.offsetWidth - list.clientWidth)}px`)
      list.classList.add('sidebar__list--dragging')
      list.setPointerCapture(event.pointerId)
    }
    drag.row.style.transform = `translateY(${String(event.clientY - drag.startY)}px)`
    const target = dropTargetAt(event.clientY, drag.boxes, drag.fromIndex, drag.headerBox)
    drag.overArchive = target.kind === 'archive'
    dockHeader.classList.toggle('sidebar__dock-header--target', drag.overArchive)
    // Aiming at the archive is not aiming at a slot: the list settles back.
    drag.dropIndex = target.kind === 'index' ? target.index : drag.fromIndex
    markDrop(drag.dropIndex)
  })

  /*
   * A drop that reorders keeps the preview on screen: the new order arrives with
   * the next render, after main has written it, and clearing the transforms
   * before then would flash the old order for a few frames. The render replaces
   * the rows, transforms and all.
   */
  function settleIntoSlot(): void {
    if (drag === null) return
    const { boxes, fromIndex, dropIndex, row } = drag
    const dragged = boxes[fromIndex]
    if (dragged === undefined) return
    const next = boxes[fromIndex + 1] ?? boxes[fromIndex - 1]
    const slot = next === undefined ? dragged.height : Math.abs(next.top - dragged.top)
    row.style.transform = `translateY(${String((dropIndex - fromIndex) * slot)}px)`
    row.classList.remove('sidebar__row--dragging')
    endListDragStyles()
    endDockTarget()
  }

  const finishDrag = (event: PointerEvent): void => {
    if (drag === null || event.pointerId !== drag.pointerId) return
    const { id, fromIndex, dropIndex, moved, overArchive } = drag
    if (moved && dropIndex !== fromIndex) settleIntoSlot()
    else endDragVisuals()
    drag = null
    releaseDragPointer(event.pointerId)
    if (!moved) return
    swallowClick = true
    if (overArchive) hooks.onArchive(id)
    else if (dropIndex !== fromIndex) hooks.onReorder(id, dropIndex)
  }
  list.addEventListener('pointerup', finishDrag)
  list.addEventListener('pointercancel', () => cancelDrag())
  // A press that leaves the list before it becomes a drag never took capture,
  // so its pointerup lands elsewhere and would strand the drag forever.
  list.addEventListener('pointerleave', () => {
    if (drag?.moved === false) cancelDrag()
  })
  // Capture can also be revoked from under us: a removed element, a lost window.
  list.addEventListener('lostpointercapture', () => cancelDrag())

  // Capture phase: the row's own click handler must never see this one.
  list.addEventListener(
    'click',
    (event) => {
      if (!swallowClick) return
      swallowClick = false
      event.stopPropagation()
      event.preventDefault()
    },
    true,
  )

  // ── Drag out of the archive ──────────────────────────
  //
  // The reverse of dropping a row on the dock. A release above the dock's top
  // edge is on the list, and that restores the session.
  let dockDrag: {
    readonly id: string
    readonly startY: number
    readonly row: HTMLElement
    readonly pointerId: number
    moved: boolean
    /** The whole dock, header and rows: leaving it is what reads as a restore. */
    dockBox: RowBox | null
    restoring: boolean
  } | null = null

  function dockBox(): RowBox | null {
    if (!dock.isConnected) return null
    const box = dock.getBoundingClientRect()
    // Nothing laid out (hidden sidebar, headless test): nothing to leave.
    return box.height === 0 ? null : { top: box.top, height: box.height }
  }

  /**
   * Out of flow for the drag. The dock is a capped, scrolling box, so a row
   * moving up out of it would be cut off at its edge; fixed escapes that clip,
   * and the viewport coordinates it needs are the ones the row already has.
   */
  function liftRow(row: HTMLElement): void {
    const box = row.getBoundingClientRect()
    row.style.left = `${String(box.left)}px`
    row.style.top = `${String(box.top)}px`
    row.style.width = `${String(box.width)}px`
    row.classList.add('sidebar__row--lifted')
  }

  function dropRow(row: HTMLElement): void {
    row.classList.remove('sidebar__row--lifted', 'sidebar__row--restoring')
    row.style.transform = ''
    row.style.left = ''
    row.style.top = ''
    row.style.width = ''
  }

  function endDockDragVisuals(): void {
    if (dockDrag !== null) dropRow(dockDrag.row)
    dockList.classList.remove('sidebar__dock-list--dragging')
    list.classList.remove('sidebar__list--restore-target')
  }

  function cancelDockDrag(): void {
    if (dockDrag === null) return
    const { pointerId } = dockDrag
    endDockDragVisuals()
    // Cleared before the release: losing capture re-enters here.
    dockDrag = null
    if (dockList.hasPointerCapture(pointerId)) dockList.releasePointerCapture(pointerId)
  }

  dockList.addEventListener('pointerdown', (event) => {
    cancelDockDrag()
    if (event.button !== 0) return
    // On mac Ctrl+click is the right click, and it arrives as button 0.
    if (IS_MAC && event.ctrlKey) return
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('.sidebar__row')
    if (row === null || row === undefined) return
    const id = row.dataset['sessionId']
    if (id === undefined) return
    dockDrag = {
      id,
      startY: event.clientY,
      row,
      pointerId: event.pointerId,
      moved: false,
      dockBox: null,
      restoring: false,
    }
  })

  dockList.addEventListener('pointermove', (event) => {
    if (dockDrag === null) return
    if (!dockDrag.moved) {
      if (Math.abs(event.clientY - dockDrag.startY) < REORDER_THRESHOLD) return
      dockDrag.moved = true
      // Measured before the lift takes the row out of flow.
      dockDrag.dockBox = dockBox()
      liftRow(dockDrag.row)
      dockList.classList.add('sidebar__dock-list--dragging')
      dockList.setPointerCapture(event.pointerId)
    }
    dockDrag.row.style.transform = `translateY(${String(event.clientY - dockDrag.startY)}px)`
    const restoring = isRestoreDrop(event.clientY, dockDrag.dockBox)
    dockDrag.restoring = restoring
    dockDrag.row.classList.toggle('sidebar__row--restoring', restoring)
    list.classList.toggle('sidebar__list--restore-target', restoring)
  })

  const finishDockDrag = (event: PointerEvent): void => {
    if (dockDrag === null || event.pointerId !== dockDrag.pointerId) return
    const { id, moved, restoring, row, pointerId } = dockDrag
    /*
     * A restore keeps the row where the pointer left it: the list it is joining
     * arrives with the next render, and putting the row back in the dock until
     * then would show it returning to the archive it just left. That render
     * rebuilds the dock's rows, this one included.
     */
    if (moved && restoring) {
      dockList.classList.remove('sidebar__dock-list--dragging')
      list.classList.remove('sidebar__list--restore-target')
    } else endDockDragVisuals()
    dockDrag = null
    if (dockList.hasPointerCapture(pointerId)) dockList.releasePointerCapture(pointerId)
    if (!(moved && restoring)) return
    // A refused restore renders nothing, and by then the drag state that would
    // have put the row down is gone — so the row is the promise's to put back.
    void Promise.resolve(hooks.onRestore(id)).catch(() => dropRow(row))
  }
  dockList.addEventListener('pointerup', finishDockDrag)
  dockList.addEventListener('pointercancel', () => cancelDockDrag())
  // A press that leaves the dock before it becomes a drag never took capture,
  // so its pointerup lands elsewhere and would strand the drag forever.
  dockList.addEventListener('pointerleave', () => {
    if (dockDrag?.moved === false) cancelDockDrag()
  })
  dockList.addEventListener('lostpointercapture', () => cancelDockDrag())

  const onDragKey = (event: KeyboardEvent): void => {
    // A press that has not travelled yet is not a drag, and this Escape is not
    // its to eat: whoever else listens for it should still get it.
    if (drag?.moved !== true && dockDrag?.moved !== true) return
    if (event.key !== 'Escape') return
    // This Escape belongs to the drag: no menu may close and no terminal may see
    // it. Immediate, because the menus listen on window too and stopPropagation
    // does not stop siblings on the same node. An Escape with no drag under it
    // passes through untouched.
    event.preventDefault()
    event.stopImmediatePropagation()
    cancelDrag()
    cancelDockDrag()
  }
  // Capture: a bubble listener would run after the views that act on Escape.
  window.addEventListener('keydown', onDragKey, true)

  // ── Width drag ───────────────────────────────────────
  let dragFrom: { x: number; width: number } | null = null

  grip.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    grip.setPointerCapture(event.pointerId)
    dragFrom = { x: event.clientX, width }
    host.classList.add('canvas--dragging')
  })
  grip.addEventListener('pointermove', (event) => {
    if (dragFrom === null) return
    const next = Math.min(
      SIDEBAR_MAX_WIDTH,
      Math.max(SIDEBAR_MIN_WIDTH, dragFrom.width + (event.clientX - dragFrom.x)),
    )
    applyWidth(next)
  })
  const endDrag = (event: PointerEvent): void => {
    if (dragFrom === null) return
    dragFrom = null
    if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId)
    host.classList.remove('canvas--dragging')
    hooks.onWidthChange(width)
  }
  grip.addEventListener('pointerup', endDrag)
  grip.addEventListener('pointercancel', endDrag)

  function applyWidth(next: number): void {
    width = next
    // Passed as a CSS variable so sidebar and canvas read the same value.
    host.style.setProperty('--sidebar-w', `${String(next)}px`)
    fitHints()
  }

  // ── Shortcut hints ───────────────────────────────────

  /** Clear space the chord wants beside the count before it is worth printing. */
  const HINT_ROOM = 10

  /**
   * The chord sits out of flow, so it cannot squeeze the name; what it can do
   * is land on top of it. Rows without room for both drop the chord.
   */
  function fitHints(): void {
    for (const item of shownRows) {
      const open = item.querySelector<HTMLElement>('.sidebar__open')
      const meta = item.querySelector<HTMLElement>('.sidebar__meta')
      const hint = item.querySelector<HTMLElement>('.sidebar__hint')
      if (open === null || meta === null || hint === null) continue
      const box = open.getBoundingClientRect()
      // Nothing has been laid out yet (hidden sidebar, headless test): leave it.
      if (box.width === 0) continue
      const pad = Number.parseFloat(getComputedStyle(open).paddingRight)
      const free = box.right - pad - meta.getBoundingClientRect().right
      const needed = hint.getBoundingClientRect().width + HINT_ROOM
      item.classList.toggle('sidebar__row--tight', free < needed)
    }
  }

  // ── Rendering ────────────────────────────────────────

  function emptyState(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'sidebar__empty'

    const lead = document.createElement('p')
    lead.textContent = t.sidebar.emptyLead

    wrap.append(lead)
    return wrap
  }

  function row(
    session: SessionSummary,
    livePanes: number | undefined,
    isCurrent: boolean,
    index: number,
  ): HTMLElement {
    const isRunning = livePanes !== undefined
    const item = document.createElement('div')
    item.className = 'sidebar__row'
    item.dataset['sessionId'] = session.id
    if (isCurrent) item.classList.add('sidebar__row--current')
    if (session.error !== null) item.classList.add('sidebar__row--error')

    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'sidebar__open'
    open.disabled = session.error !== null

    // Only running sessions get a dot. A pane of theirs that rang recolours it,
    // which is as loud as this list gets — the row itself never moves or grows.
    const wants = wantingIds.has(session.id)
    const dot = document.createElement('span')
    dot.className = isRunning ? 'sidebar__dot sidebar__dot--on' : 'sidebar__dot'
    if (wants) dot.classList.add('sidebar__dot--wants')
    dot.title = wants ? t.sidebar.wants : isRunning ? t.sidebar.running : ''

    const name = document.createElement('span')
    name.className = 'sidebar__name'
    name.textContent = session.name

    const meta = document.createElement('span')
    meta.className = 'sidebar__meta'
    meta.textContent =
      session.error === null ? String(livePanes ?? session.paneCount) : '!'

    open.append(dot, name, meta)

    // Shown on hover only: the shortcut is a shortcut, not a label.
    const gotoHint = index < 9 ? hooks.gotoHint(index) : ''
    if (gotoHint !== '') {
      const hint = document.createElement('span')
      hint.className = 'sidebar__hint'
      hint.textContent = gotoHint
      open.append(hint)
    }
    open.addEventListener('click', () => hooks.onOpen(session.id))
    item.append(open)

    if (isRunning) {
      const close = document.createElement('button')
      close.type = 'button'
      close.className = 'sidebar__close'
      close.title = t.sidebar.endSession
      close.setAttribute('aria-label', t.sidebar.endSessionNamed(session.name))
      close.append(icon([POWER_PATH, POWER_RING], 13))
      close.addEventListener('click', (event) => {
        event.stopPropagation()
        hooks.onClose(session.id)
      })
      item.append(close)
    }

    if (session.error !== null) {
      const why = document.createElement('div')
      why.className = 'sidebar__error'
      why.textContent = session.error
      why.title = session.file
      item.append(why)
    }

    return item
  }

  /** Name only: an archived session has no panes running and nothing to do. */
  function archivedRow(session: SessionSummary): HTMLElement {
    const item = document.createElement('div')
    item.className = 'sidebar__row sidebar__row--archived'
    item.dataset['sessionId'] = session.id
    // What the right-click handler reads to know it may only offer Restore.
    item.dataset['archived'] = ''

    const name = document.createElement('span')
    name.className = 'sidebar__name'
    name.textContent = session.name
    item.append(name)
    return item
  }

  function startRename(sessionId: string): void {
    const index = shown.findIndex((s) => s.id === sessionId)
    const rowEl = shownRows[index]
    const session = shown[index]
    const name = rowEl?.querySelector<HTMLElement>('.sidebar__name')
    if (session === undefined || name === undefined || name === null) return
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'sidebar__rename'
    input.value = session.name
    let done = false
    const finish = (commit: boolean): void => {
      if (done) return
      done = true
      const next = input.value.trim()
      input.replaceWith(name)
      if (commit && next !== '' && next !== session.name) hooks.onRename(session.id, next)
    }
    input.addEventListener('keydown', (event) => {
      // While a name is being typed, no chord may reach the keymap.
      event.stopPropagation()
      // The Enter that ends Korean composition is not the Enter that commits.
      if (event.isComposing) return
      if (event.key === 'Enter') finish(true)
      if (event.key === 'Escape') finish(false)
    })
    input.addEventListener('blur', () => finish(false))
    // A click inside the input must not open the session.
    input.addEventListener('click', (event) => event.stopPropagation())
    name.replaceWith(input)
    input.focus()
    input.select()
  }

  applyWidth(width)

  return {
    element: aside,

    startRename,

    render(sessions, live, current, wanting) {
      wantingIds = wanting ?? new Set()
      // Rows are rebuilt, so a live preview has nothing to sit on — and neither
      // has a drag: a background pty ringing must not move what it measures.
      clearPreview()
      cancelDrag()
      cancelDockDrag()
      const active = sessions.filter((s) => !s.archived)
      const archived = sessions.filter((s) => s.archived)
      shown = active
      currentId = current

      if (archived.length === 0) {
        dock.remove()
        /*
         * The next drag lends this same dock back, so an emptied archive must
         * leave nothing behind: a stale row is a live session offering Restore.
         * Closing it costs a refill its open state, which is the cheaper loss.
         */
        dockList.replaceChildren()
        dockCount.textContent = ''
        setDockOpen(false)
      } else {
        dockCount.textContent = String(archived.length)
        dockList.replaceChildren(...archived.map(archivedRow))
        aside.append(dock)
      }

      if (active.length === 0) {
        shownRows = []
        list.replaceChildren(emptyState())
        return
      }
      const rows = active.map((s, i) => row(s, live.get(s.id), s.id === current, i))
      shownRows = rows
      list.replaceChildren(...rows)
      fitHints()
    },

    setVisible(next) {
      visible = next
      host.classList.toggle('canvas--sidebar-hidden', !next)
      if (next) fitHints()
    },

    setWidth(next) {
      applyWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, next)))
    },

    get visible() {
      return visible
    },

    destroy() {
      clearPreview()
      window.removeEventListener('keydown', onDragKey, true)
      aside.remove()
      grip.remove()
    },
  }
}
