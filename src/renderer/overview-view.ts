/**
 * The overview: the whole canvas as abstract cards in one screen. Reads the
 * layout through hooks and paints a snapshot — it never touches the canvas,
 * the terminals or their renderers.
 */
import type { Viewport } from './layout-geometry'
import type { Direction, Layout } from './layout-model'
import { t } from './i18n'

import { canvasWidth } from './layout-geometry'
import {
  clampStripOffset,
  columnAtLensCenter,
  columnSnapOffset,
  landingScrollX,
  type Lens,
  lensOnStrip,
  lensRect,
  moveSelection,
  type OverviewCard,
  overviewLayout,
  paneNearestY,
  stripOffsetFor,
} from './overview-model'
import { wheelPixels } from './wheel-physics'

export interface OverviewHooks {
  readonly layout: () => Layout
  readonly viewport: () => Viewport
  /** Config-error panes get the error colour; hiding them would hide the fault. */
  readonly isError: (paneId: string) => boolean
  /** Foreground command per pane, fetched once per open — the map is a snapshot. */
  readonly commands: (paneIds: readonly string[]) => Promise<Record<string, string | null>>
  /**
   * The window title the program set (OSC 0/2). Shown under the command: the
   * two answer different questions — `nvim` versus which file it has open.
   */
  readonly titles: (paneIds: readonly string[]) => Promise<Record<string, string | null>>
  /** Whether this pane rang while you were elsewhere. */
  readonly wants: (paneId: string) => boolean
  /** The user picked a pane; the caller focuses and scrolls to it. */
  readonly onJump: (paneId: string) => void
  /** The user renamed a card; the caller lands it in the layout. */
  readonly onRename: (paneId: string, title: string) => void

  /**
   * Pan mode's pick: the lens framed a region, so the canvas goes exactly
   * there rather than to wherever revealing the pane would land.
   */
  readonly onLand: (scrollX: number, paneId: string) => void
}

export interface OverviewView {
  readonly isOpen: boolean
  /** A card title is being typed: the input owns the keyboard, not the map. */
  readonly isEditing: boolean
  open(): void
  close(): void
  toggle(): void
  /**
   * Feed one keydown; true means the overview consumed it. While open it
   * consumes everything — the map owns the keys, nothing may leak to a pty.
   *
   * `toggleRequested` is the caller's verdict that this key is the overview's
   * own binding: only the caller knows what it is bound to.
   */
  handleKey(event: KeyboardEvent, toggleRequested?: boolean): boolean
  /**
   * Re-place the viewport marker from the live scroll position. The canvas can
   * still be wheeled underneath the map; a stale marker would point at the
   * wrong place.
   */
  syncViewport(): void
  /** Repaint if it happens to be open, e.g. when a pane starts asking for attention. */
  refreshIfOpen(): void
  destroy(): void
}

/** Between the map's bottom edge and the key legend under it. */
const LEGEND_GAP = 16

const ARROW_DIRECTION: Readonly<Record<string, Direction>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

export function createOverviewView(host: HTMLElement, hooks: OverviewHooks): OverviewView {
  const element = document.createElement('div')
  element.className = 'overview'
  // Focusable, so opening it takes the keyboard away from the terminal.
  element.tabIndex = -1

  const map = document.createElement('div')
  map.className = 'overview__map'

  // A status bar's worth of hints: F2 is invisible otherwise.
  const legend = document.createElement('div')
  legend.className = 'overview__legend'
  element.append(map, legend)

  function setLegend(editing: boolean): void {
    const hints = editing ? t.overview.editKeys : t.overview.mapKeys
    legend.replaceChildren(
      ...hints.flatMap((hint, index) => {
        const key = document.createElement('span')
        key.className = 'overview__legend-key'
        key.textContent = hint.key
        const label = document.createElement('span')
        label.textContent = ` ${hint.label}`
        return index === 0 ? [key, label] : [document.createTextNode(' · '), key, label]
      }),
    )
  }

  element.addEventListener('mousedown', (event) => {
    if ((event.target as HTMLElement).closest('.overview__rename') !== null) return
    const card = (event.target as HTMLElement).closest<HTMLElement>('.overview__card')
    if (card?.dataset['paneId'] !== undefined) {
      land(card.dataset['paneId'])
      return
    }
    // Outside the cards: leave the way a menu closes, without acting.
    if (event.target === element) close()
  })

  let openState = false
  let selectedId = ''
  let snapshot: Layout | null = null
  let marker: HTMLElement | null = null
  let editing: HTMLInputElement | null = null

  /** Strip offset: map coordinate x is drawn at OVERVIEW_MARGIN + x - offset. */
  let offset = 0
  let mapWidth = 0
  let scale = 1
  let lens: Lens = { x: 0, width: 0 }
  let lastCards: readonly OverviewCard[] = []
  let pannable = false
  /** The height the selection keeps as it crosses columns — the canvas's rule. */
  let desiredY = 0

  const applyPan = (): void => {
    map.style.transform = `translateX(${String(-offset)}px)`
    // The lens is fixed on screen, so on the strip it sits wherever the strip
    // has slid to. One write keeps it welded to the window.
    if (pannable && marker !== null) marker.style.left = `${String(lensOnStrip(offset, lens))}px`
  }

  /** The selection follows the lens: whichever column it frames, at desiredY. */
  const trackSelection = (): void => {
    const columnId = columnAtLensCenter(lastCards, offset, lens)
    if (columnId === null) return
    const paneId = paneNearestY(lastCards, columnId, desiredY)
    if (paneId !== null) selectCard(paneId)
  }

  const rememberY = (): void => {
    const card = lastCards.find((c) => c.paneId === selectedId)
    if (card !== undefined) desiredY = card.y + card.height / 2
  }

  // Vertical wheel pans horizontally, exactly like the canvas; both axes
  // accepted so a trackpad's sideways gesture works too.
  element.addEventListener(
    'wheel',
    (event) => {
      // A map that fits has nothing to pan: the wheel belongs to the canvas
      // underneath, which syncViewport then follows.
      if (!pannable) return
      event.preventDefault()
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX
      offset = clampStripOffset(offset + wheelPixels(delta, event.deltaMode), mapWidth, lens)
      applyPan()
      trackSelection()
    },
    { passive: false },
  )

  const px = (r: { x: number; y: number; width: number; height: number }, el: HTMLElement): void => {
    el.style.left = `${r.x}px`
    el.style.top = `${r.y}px`
    el.style.width = `${r.width}px`
    el.style.height = `${r.height}px`
  }

  function selectCard(paneId: string): void {
    selectedId = paneId
    for (const card of map.querySelectorAll<HTMLElement>('.overview__card')) {
      card.classList.toggle('overview__card--selected', card.dataset['paneId'] === paneId)
    }
  }

  function jump(paneId: string): void {
    close()
    hooks.onJump(paneId)
  }

  function startEdit(paneId: string): void {
    if (editing !== null) return
    const card = [...map.querySelectorAll<HTMLElement>('.overview__card')].find(
      (el) => el.dataset['paneId'] === paneId,
    )
    const title = card?.querySelector<HTMLElement>('.overview__title')
    if (title === undefined || title === null) return
    const previous = title.textContent ?? ''
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'overview__rename'
    input.value = previous
    const finish = (commit: boolean): void => {
      if (editing === null) return
      editing = null
      setLegend(false)
      const next = input.value.trim()
      input.replaceWith(title)
      element.focus()
      if (commit && next !== '' && next !== previous) {
        title.textContent = next
        hooks.onRename(paneId, next)
      }
    }
    input.addEventListener('keydown', (event) => {
      // Typing happens here; the session's keymap must not see any of it.
      event.stopPropagation()
      // The Enter that ends Korean composition is not the Enter that commits.
      if (event.isComposing) return
      if (event.key === 'Enter') finish(true)
      if (event.key === 'Escape') finish(false)
    })
    input.addEventListener('blur', () => finish(false))
    editing = input
    setLegend(true)
    title.replaceWith(input)
    input.focus()
    input.select()
  }

  /** Pan mode's pick: the canvas goes to the region the lens framed. */
  function land(paneId: string = selectedId): void {
    if (!pannable || snapshot === null) {
      jump(paneId)
      return
    }
    const scrollX = landingScrollX(
      offset,
      scale,
      canvasWidth(snapshot),
      hooks.viewport(),
      lens,
    )
    close()
    hooks.onLand(scrollX, paneId)
  }

  function render(): void {
    const layout = hooks.layout()
    snapshot = layout
    const overview = overviewLayout(layout, hooks.viewport())

    map.replaceChildren()
    map.style.width = `${overview.width}px`
    map.style.height = `${overview.height}px`
    // The legend belongs to the map, not to the window: the map is centred, so
    // its bottom edge is half its height below the middle.
    legend.style.top = `calc(50% + ${String(overview.height / 2 + LEGEND_GAP)}px)`

    mapWidth = overview.width
    lastCards = overview.cards
    scale = overview.scale
    pannable = overview.width > hooks.viewport().width - 96 // 96 = 2 × OVERVIEW_MARGIN
    lens = lensRect(hooks.viewport(), overview.scale, overview.width)
    element.classList.toggle('overview--pannable', pannable)
    // A repaint is not a navigation event — a background pane ringing must not
    // slide the strip under the hand that just moved it. Only opening aligns.
    offset = pannable ? clampStripOffset(offset, mapWidth, lens) : 0

    const titles = new Map(
      layout.columns.flatMap((c) => c.panes.map((p) => [p.id, p.title] as const)),
    )
    for (const card of overview.cards) {
      const el = document.createElement('div')
      el.className = 'overview__card'
      el.dataset['paneId'] = card.paneId
      if (hooks.isError(card.paneId)) el.classList.add('overview__card--error')
      if (hooks.wants(card.paneId)) el.classList.add('overview__card--wants')
      px(card, el)

      const title = document.createElement('div')
      title.className = 'overview__title'
      title.textContent = titles.get(card.paneId) ?? ''
      const command = document.createElement('div')
      command.className = 'overview__command'
      const reported = document.createElement('div')
      reported.className = 'overview__reported'
      el.append(title, command, reported)
      map.append(el)
    }

    /*
     * Pan mode: the lens is the fixed frame the strip slides under, so it is
     * placed from the offset, not from the canvas scroll. Fit mode keeps the
     * marker that moves with the canvas.
     */
    marker = document.createElement('div')
    marker.className = 'overview__viewport'
    px(
      pannable
        ? { x: lensOnStrip(offset, lens), y: 0, width: lens.width, height: overview.height }
        : overview.viewportRect,
      marker,
    )
    map.append(marker)
    applyPan()

    // Same reason: a repaint keeps the user's selection, and only falls back to
    // focus when the pane it pointed at is gone.
    selectCard(
      overview.cards.some((c) => c.paneId === selectedId) ? selectedId : layout.focusedPaneId,
    )

    // The commands arrive late and fill in; the map itself never waits for IPC.
    const paneIds = overview.cards.map((c) => c.paneId)
    void hooks.commands(paneIds).then((commands) => {
      if (!openState) return
      for (const el of map.querySelectorAll<HTMLElement>('.overview__card')) {
        const running = commands[el.dataset['paneId'] ?? ''] ?? null
        if (running === null) continue
        el.classList.add('overview__card--running')
        const command = el.querySelector<HTMLElement>('.overview__command')
        if (command !== null) command.textContent = running
      }
    })
    void hooks.titles(paneIds).then((reported) => {
      if (!openState) return
      for (const el of map.querySelectorAll<HTMLElement>('.overview__card')) {
        const text = reported[el.dataset['paneId'] ?? ''] ?? null
        if (text === null) continue
        const line = el.querySelector<HTMLElement>('.overview__reported')
        if (line !== null) line.textContent = text
      }
    })
  }

  function close(): void {
    if (!openState) return
    openState = false
    snapshot = null
    marker = null
    // The editor goes with the map that holds it.
    editing = null

    offset = 0
    pannable = false
    element.remove()
  }

  function open(): void {
    if (openState) return
    openState = true
    setLegend(false)
    // Opening starts at the focused pane, wherever the last visit ended up.
    selectedId = hooks.layout().focusedPaneId
    offset = 0
    render()
    rememberY()
    if (pannable) {
      // Align the strip so the canvas region you are looking at sits in the lens.
      offset = clampStripOffset(
        stripOffsetFor(hooks.viewport().scrollX, scale, lens),
        mapWidth,
        lens,
      )
      applyPan()
      // The focused pane keeps the selection only if the lens actually frames it.
      const framed = columnAtLensCenter(lastCards, offset, lens)
      const focusedCard = lastCards.find((c) => c.paneId === selectedId)
      if (focusedCard === undefined || focusedCard.columnId !== framed) trackSelection()
    }
    host.append(element)
    element.focus()
  }

  return {
    get isOpen() {
      return openState
    },
    get isEditing() {
      return editing !== null
    },
    open,
    close,
    toggle() {
      if (openState) close()
      else open()
    },

    handleKey(event, toggleRequested = false) {
      if (!openState || snapshot === null) return false
      // The editor owns the keys; even bubbled ones must not move the map.
      if (editing !== null) return true
      if (event.key === 'F2') {
        startEdit(selectedId)
        return true
      }
      const dir = ARROW_DIRECTION[event.code]
      if (dir !== undefined) {
        if (!pannable) {
          // Fit mode: nothing slides, so a step is the canvas's own focus move.
          snapshot = moveSelection(snapshot, selectedId, dir)
          selectCard(snapshot.focusedPaneId)
          return true
        }
        if (dir === 'left' || dir === 'right') {
          // Every press moves the screen: the next column comes to the lens.
          offset = clampStripOffset(columnSnapOffset(lastCards, offset, dir, lens), mapWidth, lens)
          applyPan()
          trackSelection()
          return true
        }
        // Vertical stays inside the framed column, and sets the height to keep.
        const stepped = moveSelection(snapshot, selectedId, dir)
        snapshot = stepped
        const framed = columnAtLensCenter(lastCards, offset, lens)
        const moved = lastCards.find((c) => c.paneId === stepped.focusedPaneId)
        if (moved !== undefined && moved.columnId === framed) selectCard(stepped.focusedPaneId)
        rememberY()
        return true
      }
      if (event.key === 'Enter') {
        land()
        return true
      }
      // The key that opened the map closes it, whatever it has been bound to.
      if (event.key === 'Escape' || toggleRequested) {
        close()
        return true
      }
      return true // Everything else dies here: the map owns the keys.
    },

    refreshIfOpen() {
      // Not mid-rename: a repaint replaces the cards, and taking the input away
      // fires no blur, so the editor would be gone with the view still owning
      // the keys. The map is a snapshot anyway; it may miss one repaint.
      if (openState && editing === null) render()
    },

    syncViewport() {
      // Pan mode owns the wheel and the lens never moves, so there is nothing
      // to follow: only a map that fits lets the canvas scroll underneath.
      if (!openState || snapshot === null || marker === null || pannable) return
      px(overviewLayout(snapshot, hooks.viewport()).viewportRect, marker)
    },

    destroy() {
      close()
    },
  }
}
