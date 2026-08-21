/**
 * Turns one SessionSpec into a live screen. This is the only assembly point,
 * and so contains no maths — layout-model and layout-geometry did that.
 */
import type {
  AppSettings,
  Bindings,
  ConfigIssue,
  LayoutSnapshot,
  PaneSpec,
  SessionSpec,
  TerminalTheme,
} from '../shared/protocol'
import { api } from './api'
import { IS_MAC } from './platform'
import { t } from './i18n'
import { createCanvasView, type CanvasView } from './canvas-view'
import { renderConfigError, renderExitBanner } from './error-card'
import { columnHeightIn, maxColumnWidth, visiblePaneIds } from './layout-geometry'
import { isAppAction, resolveAction, type Action } from './keymap'
import {
  addColumn,
  allPanes,
  closePane,
  createLayout,
  findPane,
  focusDir,
  movePane,
  renamePane,
  resizeColumn,
  resizePane,
  splitPane,
  toggleMinimized,
  type ColumnSeed,
  type Direction,
  type Layout,
} from './layout-model'
import { layoutSnapshot } from './layout-snapshot'
import { createOverviewView } from './overview-view'
import { decideBudget, MAX_WEBGL_CONTEXTS, type BudgetDecision } from './renderer-budget'
import { attachResizeDrag } from './resize-drag'
import { createSearchBar } from './search-bar'
import { createTerminalPane, type TerminalPane } from './terminal-pane'

/**
 * Actions that rearrange the canvas, and so cannot run against a zoomed pane.
 *
 * tmux's rule: the zoom is dropped first and the action then lands on the real
 * layout, rather than on a screen that is not what the layout says it is.
 *
 * 'focus' is the exception handleKey makes: it drops the zoom and does no more,
 * because a move needs the layout visible to aim at.
 */
const EXITS_ZOOM: readonly Action['t'][] = [
  'focus',
  'resize',
  'split',
  'move',
  'add-column',
  'close-pane',
  'overview',
  // Folding rearranges the column, so the zoom goes first and the bar appears
  // where the layout really puts it.
  'fold',
]

/**
 * Is this key on its way to something that takes typing of its own?
 *
 * The fold swallow runs at window capture, before the target has seen anything,
 * so it has to recognise the surfaces that are not the canvas. The sidebar's
 * rename box never silences the session, and swallowing its keys would leave it
 * impossible to type in — with plain Enter unfolding a pane rather than
 * committing the name. Inside a pane the target is xterm's own textarea, which
 * is precisely what the swallow exists for.
 */
function typesIntoChrome(event: KeyboardEvent): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('.pane') !== null) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  )
}

/** A SIGWINCH storm during a drag makes full-screen apps redraw constantly. */
const PTY_RESIZE_DEBOUNCE_MS = 100
const RESIZE_STEP_PX = 40
/** How long a size must hold still before the terminal grids follow it. */
const SIZE_SETTLE_MS = 90
/** How long the view must hold still before WebGL contexts are taken. */
const ATTACH_SETTLE_MS = 120

/**
 * Ids must be unique across sessions: pty-host keys on paneId globally and
 * sessions outlive switching, so a per-session counter would collide.
 */
let nextId = 0
const newId = (prefix: string): string => `${prefix}${++nextId}`

/**
 * Who holds a WebGL context, across every session on the page.
 *
 * The cap is the page's, but a session leaving is not a reason to spend it:
 * sessions keep their contexts and give them up only when the one on screen
 * genuinely runs out of slots.
 */
interface ContextHolder {
  readonly isActive: () => boolean
  readonly held: () => number
  /** Give up at most `count` contexts; returns how many actually went. */
  readonly release: (count: number) => number
}

const contextHolders = new Set<ContextHolder>()

function pageContexts(): number {
  let total = 0
  for (const holder of contextHolders) total += holder.held()
  return total
}

/** Take slots back from sessions that are off screen, oldest holder first. */
function freeContexts(count: number, mine: ContextHolder): void {
  let freed = 0
  for (const holder of contextHolders) {
    if (freed >= count) return
    if (holder === mine || holder.isActive()) continue
    freed += holder.release(count - freed)
  }
}

export interface SessionRuntime {
  readonly spec: SessionSpec
  /** Adopt a new display name, so a later save writes it. */
  rename(name: string): void
  /** Whether this session takes keyboard input; hidden ones must not. */
  setActive(active: boolean): void
  /** The focused pane's title, for the title bar. Null with nothing focused. */
  focusedPaneTitle(): string | null
  /** Reapply settings to every live terminal. */
  applySettings(settings: AppSettings): void
  /**
   * Menu commands, sharing the shortcut path so the two can't diverge.
   */
  splitFocused(side: 'up' | 'down'): void
  addColumnBesideFocused(side: 'left' | 'right'): void
  /** Run one command in a new pane, splitting below the focused one. */
  openCommandPane(command: string): void
  closeFocusedPane(): void
  /** Lay the focused pane over the canvas, or put it back. */
  toggleZoom(): void
  /** Fold the focused pane to a bar, or open it again. */
  toggleFold(): void
  /**
   * The clipboard actions for callers that are not the keymap: on mac the
   * application menu owns Cmd+C/V, so the keydown never reaches the page.
   */
  copySelection(): void
  pasteIntoFocused(): void
  /** Whether a vertical split fits; drives the button's enabled state. */
  canSplit(): boolean
  /**
   * A pane rang or sent a notification. False when the pane is not this
   * session's, so the caller can find whose it is.
   */
  noteAttention(paneId: string): boolean
  /** Whether any pane of this session is still asking to be looked at. */
  wantsAttention(): boolean
  /**
   * Focus a pane and scroll it into view. False when the pane is not this
   * session's, so the caller can find whose it is.
   */
  focusPane(paneId: string): boolean
  /** The pane being watched: focused, and only while this session is on screen. */
  watchedPaneId(): string | null
  /** The current layout, handed to main when saving. */
  snapshot(): LayoutSnapshot
  /** Slide the canvas sideways, for surfaces outside it. */
  panCanvas(delta: number, deltaMode: number): void
  /**
   * Session became visible again: remeasure without moving the view.
   */
  refresh(): void
  /**
   * Only the canvas width changed. Remeasure and redraw without moving the
   * view — collapsing the sidebar says nothing about where you are looking.
   */
  relayout(): void
  destroy(): void
}

export interface StartSessionOptions {
  readonly spec: SessionSpec
  /** Absolute path of the session YAML, shown on config error cards. */
  readonly file: string
  readonly home: string
  readonly host: HTMLElement
  /** Settings as a function, since they change while the app runs. */
  readonly settings: () => AppSettings
  /** Keybindings, likewise — the settings screen edits them live. */
  readonly bindings: () => Bindings
  /**
   * Current palette. The shell resolves the name, since it holds the user list.
   */
  readonly theme: () => TerminalTheme
  /**
   * Title changed; the app bar draws it. The pane title is the focused pane's,
   * or null when nothing is focused.
   */
  readonly onTitle: (title: string, paneTitle: string | null) => void
  /** Something reached the clipboard — invisible, so it needs announcing. */
  readonly onCopied: (chars: number) => void
  /** A pane was added or removed; the session list shows the count. */
  readonly onPanesChanged: () => void
  /** A pane title was edited; a title alone is not worth losing on a restart. */
  readonly onPaneRenamed: () => void
  /** A pane started or stopped asking to be looked at; the sidebar shows it. */
  readonly onAttentionChanged: () => void
  /** Focus moved to another pane; main decides notifications by what is watched. */
  readonly onWatchedPaneChanged: () => void
  readonly onEnd: () => void
}

interface PaneRecord {
  readonly terminal: TerminalPane
  resizeTimer: number | null
}

export function startSession(options: StartSessionOptions): SessionRuntime {
  let spec = options.spec
  const { host } = options
  // Toggled by main.ts when switching sessions.
  let active = false

  // Spec to layout seeds; error entries take a slot too.
  const paneSpecs = new Map<string, PaneSpec>()
  const paneErrors = new Map<string, ConfigIssue>()
  const seeds: ColumnSeed[] = spec.columns.map((column) => ({
    id: newId('c'),
    width: column.width,
    panes: column.panes.map((entry) => {
      const id = newId('p')
      if (entry.kind === 'pane') paneSpecs.set(id, entry)
      else paneErrors.set(id, entry.issue)
      return {
        id,
        title: entry.kind === 'pane' ? entry.title : t.runtime.configError,
        heightRatio: entry.heightRatio,
        // An error card is a fault to read, so it is never folded away.
        minimized: entry.kind === 'pane' && entry.minimized,
      }
    }),
  }))

  let layout = createLayout(seeds)
  const records = new Map<string, PaneRecord>()
  const searchBar = createSearchBar()
  const failedPanes = new Set<string>()

  // ── Renderer budget ──────────────────────────────────
  let frozen: string[] = []
  let attached: string[] = []
  const lastSeen = new Map<string, number>()
  let seenClock = 0
  /** Pending grid resize while a size is still moving; see settleSizes. */
  let settleTimer: number | null = null
  let attachTimer: number | null = null

  const canvas: CanvasView = createCanvasView(host, {
    onPaneMouseDown: (paneId) => {
      if (paneId === layout.focusedPaneId) return
      setLayout({ ...layout, focusedPaneId: paneId })
    },
    onPaneClick: (paneId) => {
      // Focusing another pane already scrolls to it; only the pane that is
      // focused already would otherwise sit half off screen with nothing to do.
      if (paneId === layout.focusedPaneId) revealFocused()
    },
    onScroll: () => {
      updateBudget()
      // The canvas can be wheeled under the open map; the marker must follow.
      overview.syncViewport()
    },
    scrollBoost: () => options.settings().scrollBoost,
    shiftPans: () => options.settings().shiftPanning === 1,
  })

  /*
   * The zoomed pane, if any. View state only: the layout is untouched, so a
   * save writes the columns as they really are.
   */
  let zoomedPaneId: string | null = null

  /*
   * Panes that rang while you were elsewhere. Cleared by looking at the pane,
   * which is the whole answer to "did I see it?" — nothing else dismisses it.
   */
  const attention = new Set<string>()

  /** What each folded pane's bar last said it was running. */
  const foldCommands = new Map<string, string>()

  const isFolded = (paneId: string): boolean =>
    findPane(layout, paneId)?.pane.minimized === true

  function refreshFoldDetail(paneId: string): void {
    canvas.setFoldDetail(paneId, {
      command: foldCommands.get(paneId) ?? '',
      wants: attention.has(paneId),
    })
  }

  /** Ask what the pane is running, the way the overview asks for its cards. */
  function loadFoldDetail(paneId: string): void {
    void api.foregroundCommands([paneId]).then((commands) => {
      foldCommands.set(paneId, commands[paneId] ?? '')
      refreshFoldDetail(paneId)
    })
  }

  const overview = createOverviewView(host, {
    layout: () => layout,
    viewport: () => canvas.getViewport(),
    isError: (paneId) => paneErrors.has(paneId),
    commands: (paneIds) => api.foregroundCommands(paneIds),
    titles: (paneIds) => api.paneTitles(paneIds),
    wants: (paneId) => attention.has(paneId),
    onJump: (paneId) => {
      if (paneId !== layout.focusedPaneId) {
        setLayout({ ...layout, focusedPaneId: paneId })
        return
      }
      // Same pane: setLayout would be a no-op, but the view should still settle on it.
      revealFocused()
    },
    onRename: (paneId, title) => {
      setLayout(renamePane(layout, paneId, title))
      publishTitle()
      options.onPaneRenamed()
    },
    onScrub: (scrollX) => {
      // Follow the lens with the canvas itself: nothing takes focus, nothing
      // closes. Leaving the map without landing scrubs back.
      canvas.scrollByExact(scrollX - canvas.scrollState().offset)
    },
    onLand: (scrollX, paneId) => {
      // Focus first: it scrolls to reveal the pane, and the lens framed a
      // region rather than a pane, so that scroll has to be the one overruled.
      if (paneId !== layout.focusedPaneId) setLayout({ ...layout, focusedPaneId: paneId }, 'settle')
      canvas.scrollByExact(scrollX - canvas.scrollState().offset)
    },
  })

  const detachDrag = attachResizeDrag(canvas.root, {
    onColumnDrag: (columnId, dx) =>
      setLayout(resizeColumn(layout, columnId, dx, columnWidthCap()), 'settle'),
    onPaneDrag: (paneId, dy) => setLayout(resizePane(layout, paneId, dy, columnHeight()), 'settle'),
    onDragEnd: () => syncSizes(),
    viewport: () => {
      const state = canvas.scrollState()
      return { left: state.left, width: state.viewport }
    },
    /*
     * Widen first, then scroll: the column growing is what lengthens the canvas
     * the scroll moves into, so the room is made by the same step that uses it.
     */
    onColumnEdgePush: (columnId, step) => {
      const next = resizeColumn(layout, columnId, step, columnWidthCap())
      if (next === layout) return false // At the width cap; do not slide on
      setLayout(next, 'settle')
      canvas.scrollByExact(step)
      return true
    },
  })

  const holder: ContextHolder = {
    isActive: () => active,
    held: () => attached.length,
    release: (count) => {
      // Least recently seen first: the panes least likely to be looked at next.
      const order = [...attached].sort(
        (a, b) => (lastSeen.get(a) ?? -Infinity) - (lastSeen.get(b) ?? -Infinity),
      )
      const victims = new Set(order.slice(0, count))
      for (const paneId of victims) records.get(paneId)?.terminal.detachRenderer()
      attached = attached.filter((id) => !victims.has(id))
      return victims.size
    },
  }
  contextHolders.add(holder)

  function budgetDecision(): BudgetDecision {
    // Error cards have no terminal and would only consume WebGL slots.
    const hasTerminal = (paneId: string): boolean => records.has(paneId)
    const visible = visiblePaneIds(canvas.getRects(), canvas.getViewport()).filter(hasTerminal)
    for (const paneId of visible) lastSeen.set(paneId, ++seenClock)

    return decideBudget({
      allPaneIds: allPanes(layout).map((p) => p.id).filter(hasTerminal),
      // A folded pane draws none of its terminal, so it needs no renderer and
      // nothing of it has to stay awake — not even while it holds the keyboard.
      visible: visible.filter((id) => !isFolded(id)),
      frozen,
      attached,
      focusedPaneId: isFolded(layout.focusedPaneId) ? null : layout.focusedPaneId,
      lastSeen,
      active,
    })
  }

  /**
   * Giving a context back is immediate; taking one waits for things to settle.
   *
   * A WebGL context is a page-wide resource the browser reclaims lazily. Asking
   * for a dozen of them on every session switch outruns that reclaim, and past
   * the browser's own cap it force-releases the oldest — a pane left white.
   * Until the attach lands the pane still draws, through the DOM renderer.
   */
  function updateBudget(): void {
    const decision = budgetDecision()

    for (const paneId of decision.thaw) {
      // Clear content-visibility first, or the size can't be measured.
      canvas.setPaneFrozen(paneId, false)
      const record = records.get(paneId)
      record?.terminal.thaw()
      record?.terminal.setSize()
    }
    for (const paneId of decision.freeze) {
      records.get(paneId)?.terminal.freeze()
      canvas.setPaneFrozen(paneId, true)
    }
    for (const paneId of decision.detach) records.get(paneId)?.terminal.detachRenderer()

    frozen = frozen
      .filter((id) => !decision.thaw.includes(id))
      .concat(decision.freeze)
    attached = attached.filter((id) => !decision.detach.includes(id))

    if (decision.attach.length > 0) scheduleAttach()
  }

  function scheduleAttach(): void {
    if (attachTimer !== null) window.clearTimeout(attachTimer)
    attachTimer = window.setTimeout(() => {
      attachTimer = null
      // Decide again: a burst of switches has left the earlier answer stale.
      const decision = budgetDecision()
      // Sessions off screen are still holding slots; take only what is short.
      const shortfall = decision.attach.length - (MAX_WEBGL_CONTEXTS - pageContexts())
      if (shortfall > 0) freeContexts(shortfall, holder)
      const room = Math.max(0, MAX_WEBGL_CONTEXTS - pageContexts())
      const take = decision.attach.slice(0, room)
      for (const paneId of take) records.get(paneId)?.terminal.attachRenderer()
      attached = attached.concat(take)
    }, ATTACH_SETTLE_MS)
  }

  // ── State ────────────────────────────────────────────

  function focusedPaneTitle(): string | null {
    return findPane(layout, layout.focusedPaneId)?.pane.title ?? null
  }

  function publishTitle(): void {
    // Only the visible session owns the bar; a background one would overwrite it.
    if (!active) return
    options.onTitle(spec.name, focusedPaneTitle())
  }

  function columnHeight(): number {
    return columnHeightIn(host.clientHeight)
  }

  function columnWidthCap(): number {
    return maxColumnWidth(host.clientWidth)
  }

  /**
   * Bring the focused pane back into view, wherever the canvas has been left.
   *
   * Focus moves scroll on their own; this is for the cases where focus does not
   * change — a click on the focused pane, a map jump to it, Alt+G, and moving
   * the focused pane, where the pane travels and the focus does not.
   */
  function revealFocused(): void {
    canvas.scrollToPane(layout.focusedPaneId, layout)
    if (!isFolded(layout.focusedPaneId)) records.get(layout.focusedPaneId)?.terminal.focus()
  }

  /** Have every terminal remeasure after a DOM size change. */
  function syncSizes(): void {
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer)
      settleTimer = null
    }
    for (const record of records.values()) record.terminal.setSize()
  }

  /*
   * The same, for a size that is still changing.
   *
   * xterm clears its glyph model on resize and repaints a frame later, so a
   * grid resized on every frame of a drag shows one empty frame per frame —
   * which is what the flicker was. The boxes follow the pointer live; the
   * grids catch up once the motion stops.
   */
  function settleSizes(): void {
    if (settleTimer !== null) window.clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => {
      settleTimer = null
      syncSizes()
    }, SIZE_SETTLE_MS)
  }

  function exitZoom(): void {
    const paneId = zoomedPaneId
    if (paneId === null) return
    zoomedPaneId = null
    canvas.setZoom(null)
    // The pane is back at its layout size; its grid has to follow the box.
    records.get(paneId)?.terminal.setSize()
  }

  function toggleZoom(): void {
    if (zoomedPaneId !== null) {
      exitZoom()
      return
    }
    // A bar has nothing to blow up: open the pane first, then lay it over.
    unfoldFocused()
    zoomedPaneId = layout.focusedPaneId
    canvas.setZoom(zoomedPaneId)
    records.get(zoomedPaneId)?.terminal.setSize()
  }

  function toggleFold(): void {
    const paneId = layout.focusedPaneId
    const folding = !isFolded(paneId)
    setLayout(toggleMinimized(layout, paneId))
    if (folding) {
      /*
       * Nothing of the pane is on screen any more, so it must not hold the
       * keyboard either: a keystroke landing in a shell nobody can see is input
       * with no way of knowing what it did. The pty keeps running regardless.
       */
      records.get(paneId)?.terminal.setFocused(false)
      loadFoldDetail(paneId)
      return
    }
    const record = records.get(paneId)
    record?.terminal.setFocused(true)
    record?.terminal.focus()
    // Back at its layout height, so the grid has to follow the box.
    record?.terminal.setSize()
  }

  /** Open the focused pane if it is folded, for an action that needs its body. */
  function unfoldFocused(): void {
    if (isFolded(layout.focusedPaneId)) toggleFold()
  }

  function setLayout(next: Layout, sizes: 'now' | 'settle' = 'now'): void {
    const focusChanged = next.focusedPaneId !== layout.focusedPaneId
    const previousFocus = layout.focusedPaneId
    const paneCountBefore = allPanes(layout).length
    layout = next
    canvas.render(layout)
    if (sizes === 'now') syncSizes()
    else settleSizes()

    if (focusChanged) {
      options.onWatchedPaneChanged()
      // Looking at it is what dismisses it.
      if (attention.delete(layout.focusedPaneId)) {
        options.onAttentionChanged()
        refreshFoldDetail(layout.focusedPaneId)
      }
      // The bar belongs to the focused pane; a bar left on an unfocused one lies.
      searchBar.close()
      records.get(previousFocus)?.terminal.setFocused(false)
      const record = records.get(layout.focusedPaneId)
      // Focus lands on a folded bar like any other pane, but the terminal under
      // it takes neither the caret nor the keys.
      const folded = isFolded(layout.focusedPaneId)
      record?.terminal.setFocused(!folded)
      if (!folded) record?.terminal.focus()
      canvas.scrollToPane(layout.focusedPaneId, layout)
      publishTitle()
    }
    updateBudget()
    if (allPanes(layout).length !== paneCountBefore) options.onPanesChanged()
  }

  // ── Pane creation ────────────────────────────────────

  function spawnPane(paneId: string, paneSpec: PaneSpec, terminal: TerminalPane, cwdOverride?: string | Promise<string>): void {
    void (async () => {
      const cwd = cwdOverride !== undefined ? await cwdOverride : paneSpec.cwd
      paneSpecs.set(paneId, { ...paneSpec, cwd })
      return api.spawn({
        paneId,
        cwd,
        shell: spec.shell,
        command: paneSpec.command,
        prefill: paneSpec.prefill,
        cols: terminal.cols,
        rows: terminal.rows,
      })
    })().then((result) => {
      if (result.ok) return
      failedPanes.add(paneId)
      // Keep the pane and write the reason into it.
      terminal.write(
        `\r\n\x1b[38;2;207;122;106m${result.message ?? t.runtime.spawnFailed}\x1b[0m\r\n`,
      )
    })
  }

  function mountPane(paneId: string, cwdOverride?: string | Promise<string>): void {
    const body = canvas.paneBody(paneId)
    if (body === null) return

    const issue = paneErrors.get(paneId)
    if (issue !== undefined) {
      renderConfigError(body, issue, options.file)
      return // do not spawn a pty
    }

    const paneSpec = paneSpecs.get(paneId)
    if (paneSpec === undefined) return

    const { fontSize, lineHeight, scrollback, fontFamily, scrollBoost, textRendering } =
      options.settings()
    const terminal = createTerminalPane({
      paneId,
      appearance: {
        fontSize,
        lineHeight,
        scrollback,
        fontFamily,
        scrollBoost,
        theme: options.theme(),
        textRendering,
      },
      onInput: (data) => api.write(paneId, data),
      // The addon detaches itself on context loss; untrack it or it never returns.
      onRendererLost: () => {
        attached = attached.filter((id) => id !== paneId)
      },
      onSelected: (text) => {
        if (options.settings().copyOnSelect !== 1) return
        api.writeClipboard(text)
        options.onCopied(text.length)
      },
      onResize: (cols, rows) => {
        const record = records.get(paneId)
        if (record === undefined) return
        if (record.resizeTimer !== null) window.clearTimeout(record.resizeTimer)
        record.resizeTimer = window.setTimeout(() => {
          record.resizeTimer = null
          api.resize(paneId, cols, rows)
        }, PTY_RESIZE_DEBOUNCE_MS)
      },
    })

    body.append(terminal.element)
    records.set(paneId, { terminal, resizeTimer: null })
    terminal.setSize()
    spawnPane(paneId, paneSpec, terminal, cwdOverride)
  }

  function unmountPane(paneId: string): void {
    const record = records.get(paneId)
    if (record === undefined) return
    failedPanes.delete(paneId)
    if (record.resizeTimer !== null) window.clearTimeout(record.resizeTimer)
    record.terminal.dispose()
    records.delete(paneId)
    attached = attached.filter((id) => id !== paneId)
    frozen = frozen.filter((id) => id !== paneId)
    lastSeen.delete(paneId)
    foldCommands.delete(paneId)
    api.kill(paneId)
  }

  // ── Actions ──────────────────────────────────────────

  function removePane(paneId: string): void {
    // A pane that is going cannot stay zoomed; its terminal is about to go too,
    // so the state is dropped rather than resized back.
    if (paneId === zoomedPaneId) {
      zoomedPaneId = null
      canvas.setZoom(null)
    }
    const next = closePane(layout, paneId)
    unmountPane(paneId)
    paneSpecs.delete(paneId)
    paneErrors.delete(paneId)
    if (next === null) {
      options.onEnd() // that was the session's last pane — back to the list screen
      return
    }
    setLayout(next)
  }

  function applyResize(dir: Direction): void {
    exitZoom()
    const found = findPane(layout, layout.focusedPaneId)
    if (found === null) return
    if (dir === 'left' || dir === 'right') {
      setLayout(
        resizeColumn(
          layout,
          found.column.id,
          dir === 'right' ? RESIZE_STEP_PX : -RESIZE_STEP_PX,
          columnWidthCap(),
        ),
        'settle',
      )
      /*
       * Widths are absolute, so a column grows to the right and the far edge of
       * the one being widened walks off screen. The scroll follows it, which
       * from the viewer's side reads as the column growing leftward from the
       * right edge. Drags are left alone — the canvas sliding under a held
       * pointer is worse than the clipping.
       */
      canvas.scrollToPane(layout.focusedPaneId, layout)
    } else {
      setLayout(
        resizePane(
          layout,
          layout.focusedPaneId,
          dir === 'down' ? RESIZE_STEP_PX : -RESIZE_STEP_PX,
          columnHeight(),
        ),
        'settle',
      )
    }
  }

  async function focusedCwd(focusedPaneId = layout.focusedPaneId): Promise<string> {
    if (options.settings().inheritWorkingDir === 0) return spec.cwd

    if (failedPanes.has(focusedPaneId)) {
      const failedPaneCwd = paneSpecs.get(focusedPaneId)?.cwd
      return failedPaneCwd !== spec.cwd ? spec.cwd : options.home
    }

    const liveCwd = await api.cwdOf(focusedPaneId)
    if (liveCwd !== null && liveCwd !== '') return liveCwd

    return paneSpecs.get(focusedPaneId)?.cwd ?? spec.cwd
  }

  function addPane(id: string, cwd: string | Promise<string>, command: string | null = null): void {
    paneSpecs.set(id, {
      kind: 'pane',
      // Follow parsePane: the command's first word names the pane.
      title: command?.trim().split(/\s+/)[0] ?? 'shell',
      command,
      prefill: null,
      cwd: spec.cwd,
      heightRatio: 0,
      minimized: false,
    })
    mountPane(id, cwd)
    syncSizes()
    updateBudget()
    // setLayout ran before this record existed, so focus has to be applied here.
    if (layout.focusedPaneId === id) {
      const record = records.get(id)
      record?.terminal.setFocused(true)
      record?.terminal.focus()
    }
  }

  function splitFocused(side: 'up' | 'down'): void {
    exitZoom()
    // Splitting a bar would halve a height nobody can see; open it first.
    unfoldFocused()
    const id = newId('p')
    const cwd = focusedCwd() // read before focus moves away
    const next = splitPane(layout, layout.focusedPaneId, columnHeight(), { id, title: 'shell' }, side)
    if (next === layout) return // blocked by the minimum height — failure means no change
    setLayout(next)
    addPane(id, cwd)
  }

  function openCommandPane(command: string): void {
    exitZoom()
    unfoldFocused()
    const id = newId('p')
    const cwd = focusedCwd()
    const split = splitPane(layout, layout.focusedPaneId, columnHeight(), { id, title: 'shell' }, 'down')
    if (split !== layout) {
      setLayout(split)
      addPane(id, cwd, command)
      return
    }
    // The column is at minimum height — open beside it instead of failing silently.
    const found = findPane(layout, layout.focusedPaneId)
    if (found === null) return
    setLayout(
      addColumn(layout, found.column.id, {
        id: newId('c'),
        width: options.settings().defaultColumnWidth,
        pane: { id, title: 'shell' },
        side: 'right',
      }),
    )
    addPane(id, cwd, command)
  }

  function addColumnBesideFocused(side: 'left' | 'right'): void {
    exitZoom()
    const found = findPane(layout, layout.focusedPaneId)
    if (found === null) return
    const id = newId('p')
    const cwd = focusedCwd()
    setLayout(
      addColumn(layout, found.column.id, {
        id: newId('c'),
        width: options.settings().defaultColumnWidth,
        pane: { id, title: 'shell' },
        side,
      }),
    )
    addPane(id, cwd)
  }

  function canSplit(): boolean {
    return (
      splitPane(layout, layout.focusedPaneId, columnHeight(), { id: '__probe', title: '' }) !==
      layout
    )
  }

  function copySelection(): void {
    // The open overview owns every key, and the pane behind it is not being
    // looked at. The keyboard path returns before the switch for the same
    // reason; the mac menu reaches these directly, so the guard lives here.
    if (overview.isOpen) return
    // xterm owns the selection; WebGL draws to canvas so the DOM has none.
    const selection = records.get(layout.focusedPaneId)?.terminal.getSelection() ?? ''
    if (selection === '') return
    api.writeClipboard(selection)
    options.onCopied(selection.length)
  }

  function pasteIntoFocused(): void {
    // Pasting into a pane hidden behind the overview would dirty its shell line
    // out of sight; see copySelection. A folded pane is hidden the same way,
    // and the guard lives here rather than on the keyboard path because on mac
    // the Edit menu delivers Cmd+V without a keydown ever reaching the page.
    if (overview.isOpen || isFolded(layout.focusedPaneId)) return
    void api.readClipboard().then((text) => {
      if (text === '') return
      // Through xterm for bracketed paste, so multi-line input isn't executed.
      records.get(layout.focusedPaneId)?.terminal.paste(text)
    })
  }

  function onKeyDown(event: KeyboardEvent): void {
    // Every live session has a listener on window, and stopPropagation doesn't
    // stop siblings on the same node, so each must decide if it's its turn.
    if (!active) return
    const action = resolveAction(event, options.bindings(), IS_MAC)
    // The open overview owns every key; nothing may fall through to a pty.
    if (overview.isOpen) {
      // Except while a title is being typed: this listener captures, so
      // preventDefault here would cancel the letter before the input sees it.
      if (overview.isEditing) return
      if (overview.handleKey(event, action?.t === 'overview')) {
        event.preventDefault()
        event.stopPropagation()
        // Closed without a jump (Esc, Alt+M): hand the keyboard back to the pane.
        if (!overview.isOpen) records.get(layout.focusedPaneId)?.terminal.focus()
      }
      return
    }
    /*
     * A folded pane is a bar, and a bar takes no typing: the keys would reach a
     * shell with nothing on screen to show what they did. Enter is the way back
     * out, which is the one thing the bar has to answer to.
     */
    if (action === null && isFolded(layout.focusedPaneId) && !typesIntoChrome(event)) {
      event.preventDefault()
      event.stopPropagation()
      const plainEnter =
        event.key === 'Enter' &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.metaKey
      if (plainEnter) toggleFold()
      return
    }
    if (action === null) return // not the app's — pass it through to the terminal
    // App-level actions belong outside a session, or they go unheard with none open.
    if (isAppAction(action)) return
    event.preventDefault()
    event.stopPropagation()
    /*
     * A focus move out of a zoom costs two presses. Under a zoom the neighbours
     * are not on screen, so the first arrow would move blind — it drops the
     * zoom and stops there, and the second one moves with the layout in view.
     * The other zoom-exiting actions name what they act on, so they still land
     * in the same press.
     */
    if (zoomedPaneId !== null && action.t === 'focus') {
      exitZoom()
      return
    }
    if (EXITS_ZOOM.includes(action.t)) exitZoom()

    switch (action.t) {
      case 'focus':
        setLayout(focusDir(layout, action.dir))
        break
      case 'resize':
        applyResize(action.dir)
        break
      case 'split':
        splitFocused(action.side)
        break
      case 'move':
        setLayout(movePane(layout, action.dir, columnHeight(), newId('c')))
        // The pane keeps focus while moving, so nothing else would scroll after
        // it — and a pane sent into a column off screen would simply vanish.
        revealFocused()
        break
      case 'add-column':
        addColumnBesideFocused(action.side)
        break
      case 'close-pane':
        removePane(layout.focusedPaneId)
        break
      case 'copy':
        copySelection()
        break
      case 'paste':
        pasteIntoFocused()
        break
      case 'search': {
        // The bar has no scrollback on screen, and a search box inside a body
        // that is not drawn takes the keys and shows nothing.
        unfoldFocused()
        const body = canvas.paneBody(layout.focusedPaneId)
        const record = records.get(layout.focusedPaneId)
        // An error card has no scrollback to search.
        if (body === null || record === undefined) break
        searchBar.open(body, record.terminal, record.terminal.getSelection())
        break
      }
      case 'overview':
        overview.toggle()
        break
      case 'reveal-focus':
        revealFocused()
        break
      case 'zoom':
        toggleZoom()
        break
      case 'fold':
        toggleFold()
        break
    }
  }

  // ── External events ──────────────────────────────────

  const offData = api.onData((paneId, data) => records.get(paneId)?.terminal.write(data))

  const offExit = api.onExit(({ paneId, exitCode, signal }) => {
    if (!records.has(paneId)) return
    const paneSpec = paneSpecs.get(paneId)
    // A clean exit (0 or Ctrl+C 130), or any exit from a shell with no command, closes the pane.
    const isCleanExit = (exitCode === 0 || exitCode === 130) && (signal === null || signal === 0)
    if (paneSpec?.command === null || isCleanExit) {
      removePane(paneId)
      return
    }
    const body = canvas.paneBody(paneId)
    if (body === null) return
    // Never auto-close — the output says why it died.
    renderExitBanner(body, {
      exitCode,
      signal,
      onRestart: () => {
        const record = records.get(paneId)
        if (paneSpec === undefined || record === undefined) return
        spawnPane(paneId, paneSpec, record.terminal)
      },
    })
  })

  const resizeObserver = new ResizeObserver(() => {
    canvas.render(layout)
    settleSizes()
    updateBudget()
    // The map is scaled to the viewport, so a window resize leaves it drawn for
    // a width that is gone. Resizing never reaches relayout, only this.
    overview.refreshIfOpen()
  })
  resizeObserver.observe(host)

  window.addEventListener('keydown', onKeyDown, true)

  // ── Startup ──────────────────────────────────────────

  active = true
  publishTitle()
  canvas.render(layout)
  for (const pane of allPanes(layout)) mountPane(pane.id)
  setLayout(layout)
  if (!isFolded(layout.focusedPaneId)) {
    records.get(layout.focusedPaneId)?.terminal.setFocused(true)
    records.get(layout.focusedPaneId)?.terminal.focus()
  }
  for (const pane of allPanes(layout)) if (pane.minimized === true) loadFoldDetail(pane.id)

  return {
    get spec() {
      return spec
    },
    rename(name) {
      spec = { ...spec, name }
    },
    applySettings(next) {
      const appearance = {
        fontSize: next.fontSize,
        lineHeight: next.lineHeight,
        scrollback: next.scrollback,
        fontFamily: next.fontFamily,
        scrollBoost: next.scrollBoost,
        theme: options.theme(),
        // Fixed at open; a live change waits for the next start, like locale.
        textRendering: next.textRendering,
      }
      for (const record of records.values()) record.terminal.applyAppearance(appearance)
    },
    focusedPaneTitle,
    setActive(next) {
      active = next
      options.onWatchedPaneChanged()
      // Arriving is a look too. A pane that rang while this session was off
      // screen is usually the focused one, so nothing is clicked on the way in
      // and a mark waiting on a focus change would never come down.
      if (next && attention.delete(layout.focusedPaneId)) options.onAttentionChanged()
      if (!next) {
        searchBar.close()
        overview.close()
        // A session off screen must come back as its layout describes it.
        exitZoom()
        records.get(layout.focusedPaneId)?.terminal.setFocused(false)
        // Stop the panes working while nobody is looking. The WebGL contexts
        // stay: the session arriving takes them only if it runs short of slots.
        updateBudget()
      }
    },
    splitFocused,
    addColumnBesideFocused,
    openCommandPane,
    closeFocusedPane: () => removePane(layout.focusedPaneId),
    toggleZoom,
    toggleFold,
    copySelection,
    pasteIntoFocused,
    canSplit,

    panCanvas: (delta, deltaMode) => canvas.panBy(delta, deltaMode),

    wantsAttention: () => attention.size > 0,

    focusPane(paneId) {
      if (!records.has(paneId)) return false
      // setLayout is a no-op for the pane that is already focused, but the
      // canvas may have been scrolled away from it since.
      if (paneId === layout.focusedPaneId) revealFocused()
      else setLayout({ ...layout, focusedPaneId: paneId })
      return true
    },

    /*
     * A folded pane is not being watched, however focused it is: nothing of it
     * is on screen. Reporting it as watched would have main swallow the desktop
     * notification for the one pane that most needs to send one.
     */
    watchedPaneId: () =>
      active && !isFolded(layout.focusedPaneId) ? layout.focusedPaneId : null,

    noteAttention(paneId) {
      if (!records.has(paneId)) return false
      // The focused pane is already being looked at, so it has nothing to ask
      // for — unless it is folded, where holding focus shows you nothing.
      if (paneId === layout.focusedPaneId && active && !isFolded(paneId)) return true
      if (attention.has(paneId)) return true
      attention.add(paneId)
      refreshFoldDetail(paneId)
      overview.refreshIfOpen()
      options.onAttentionChanged()
      return true
    },

    snapshot: () => layoutSnapshot(layout, paneSpecs, spec.cwd),
    relayout() {
      canvas.render(layout)
      syncSizes()
      // A narrower canvas can leave the scroll past its end; clamp without moving.
      canvas.clampScroll(layout)
      updateBudget()
      // The sidebar collapsing arrives here. The ResizeObserver below sees the
      // same change, but only this path is synchronous with the toggle.
      overview.refreshIfOpen()
    },

    refresh() {
      // The host measured zero while hidden, so everything needs remeasuring.
      active = true
      publishTitle()
      canvas.render(layout)
      syncSizes()
      // Do not scroll to the focused pane. Coming back to a session must show
      // exactly what was left behind; the window may have been resized while
      // hidden, so only pull the scroll back into range.
      canvas.clampScroll(layout)
      updateBudget()
      if (!isFolded(layout.focusedPaneId)) {
        records.get(layout.focusedPaneId)?.terminal.setFocused(true)
        records.get(layout.focusedPaneId)?.terminal.focus()
      }
    },
    destroy() {
      contextHolders.delete(holder)
      searchBar.close()
      overview.destroy()
      window.removeEventListener('keydown', onKeyDown, true)
      if (settleTimer !== null) window.clearTimeout(settleTimer)
      if (attachTimer !== null) window.clearTimeout(attachTimer)
      resizeObserver.disconnect()
      detachDrag()
      offData()
      offExit()
      for (const paneId of [...records.keys()]) unmountPane(paneId)
      canvas.destroy()
    },
  }
}
