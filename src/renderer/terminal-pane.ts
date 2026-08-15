/**
 * One xterm.js instance's lifecycle. Knows its own size and buffer, nothing
 * about layout or sessions.
 */
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon, type ILinkProviderOptions } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type ITheme } from '@xterm/xterm'
import type { TerminalTheme } from '../shared/terminal-themes'
import { api } from './api'
import { guardImeDoubleCommit } from './ime-double-commit'
import { ImeTrace } from './ime-trace'
import { isLinkActivation } from './link-activation'
import { IS_MAC } from './platform'
import { shellQuote } from '../shared/shell-quote'
import { FRAME_MS, glideFactor, nextBurst, wheelPixels } from './wheel-physics'

/** Queue cap for a frozen pane. Past this, output is flushed rather than dropped. */
const FROZEN_QUEUE_LIMIT = 512 * 1024

/**
 * Palette to xterm's shape. The indirection keeps the palette pure data, since
 * both main and renderer share the type.
 */
function toXtermTheme(theme: TerminalTheme): ITheme {
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    cursorAccent: theme.background,
    selectionBackground: theme.selection,
    black: theme.black,
    red: theme.red,
    green: theme.green,
    yellow: theme.yellow,
    blue: theme.blue,
    magenta: theme.magenta,
    cyan: theme.cyan,
    white: theme.white,
    brightBlack: theme.brightBlack,
    brightRed: theme.brightRed,
    brightGreen: theme.brightGreen,
    brightYellow: theme.brightYellow,
    brightBlue: theme.brightBlue,
    brightMagenta: theme.brightMagenta,
    brightCyan: theme.brightCyan,
    brightWhite: theme.brightWhite,
    // Scrollbar: visible enough to know it's there, no more. Literal values
    // because xterm's ITheme cannot take var(); kin to the --thumb ramp.
    scrollbarSliderBackground: 'rgba(255,255,255,0.10)',
    scrollbarSliderHoverBackground: 'rgba(255,255,255,0.20)',
    scrollbarSliderActiveBackground: 'rgba(255,255,255,0.28)',
  }
}

/**
 * Open a link a program printed, on the modifier click alone.
 *
 * Main decides which schemes may leave the app; the URL is never opened in the
 * page, which would turn the renderer into an arbitrary web page.
 */
function openLink(event: MouseEvent, uri: string): void {
  if (!isLinkActivation(event, IS_MAC)) return
  api.openExternal(uri)
}

export interface TerminalPane {
  readonly element: HTMLElement
  readonly cols: number
  readonly rows: number
  write(data: string): void
  /**
   * Selected text. WebGL draws to a canvas, so window.getSelection() is always empty.
   */
  getSelection(): string
  /**
   * Paste through xterm for bracketed paste; raw multi-line input would execute per newline.
   */
  paste(text: string): void
  /** Recompute cols/rows after a size change, calling onResize if they moved. */
  setSize(): void
  /** Reapply appearance settings to a live terminal. */
  applyAppearance(appearance: TerminalAppearance): void
  focus(): void
  setFocused(focused: boolean): void
  /**
   * Move to the next or previous match, highlighting all of them. Incremental
   * keeps the current match while the query grows under the cursor.
   */
  findNext(query: string, caseSensitive: boolean, incremental?: boolean): void
  findPrevious(query: string, caseSensitive: boolean): void
  /** Drop every search highlight. */
  clearSearch(): void
  /** Match count changes, for the search bar's "3/17". Returns an unsubscribe. */
  onSearchResults(listener: (resultIndex: number, resultCount: number) => void): () => void
  freeze(): void
  thaw(): void
  attachRenderer(): void
  detachRenderer(): void
  dispose(): void
}

/** Settings that must be reapplicable to a running terminal. */
export interface TerminalAppearance {
  readonly fontSize: number
  readonly lineHeight: number
  readonly scrollback: number
  /** Chosen font; empty means the default stack. */
  readonly fontFamily: string
  /** Same dial as the canvas uses horizontally. */
  readonly scrollBoost: number
  /** Colour palette. */
  readonly theme: TerminalTheme
}

/*
 * Vertical scrolling uses the same model as the canvas.
 *
 * xterm's smoothScrollDuration is a fixed-duration tween per input: it neither
 * accelerates while rolling nor glides afterwards, which would leave two
 * different physics on one screen. Constants come from wheel-physics.
 */
/**
 * Lines per notch. The canvas multiplier goes far higher than a 40-row pane
 * can absorb, so it is capped here.
 */
const MAX_LINE_SENSITIVITY = 6

const lineSensitivity = (boost: number): number => Math.min(MAX_LINE_SENSITIVITY, Math.max(1, boost))

export interface TerminalPaneOptions {
  readonly paneId: string
  readonly appearance: TerminalAppearance
  readonly onResize: (cols: number, rows: number) => void
  readonly onInput: (data: string) => void
  /** The renderer dropped after losing its context; the caller must untrack it. */
  readonly onRendererLost?: () => void
  /**
   * A selection settled. Fires on release only, not while dragging.
   */
  readonly onSelected?: (text: string) => void
}

/**
 * Keep the default stack behind the chosen font, so glyphs it lacks fall to a
 * monospace face rather than a proportional browser default.
 */
function fontStack(chosen: string): string {
  const base = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  if (chosen === '') return base
  // Quote it — font names commonly contain spaces.
  return `"${chosen}", ${base}`
}

export function createTerminalPane(options: TerminalPaneOptions): TerminalPane {
  const element = document.createElement('div')
  element.className = 'terminal-host'
  element.style.height = '100%'

  const term = new Terminal({
    fontFamily: fontStack(options.appearance.fontFamily),
    // We drive the glide ourselves; xterm's tween would compound it.
    smoothScrollDuration: 0,
    fontSize: options.appearance.fontSize,
    lineHeight: options.appearance.lineHeight,
    allowProposedApi: true,
    // Only the focused pane blinks; twenty blinking cursors is noise.
    cursorBlink: false,
    scrollback: options.appearance.scrollback,
    // OSC 8 hyperlinks. Without a handler xterm asks through confirm() and
    // opens the page itself; these take the same route as a plain URL.
    linkHandler: { activate: openLink },
    theme: toXtermTheme(options.appearance.theme),
  })

  const unicode11 = new Unicode11Addon()
  term.loadAddon(unicode11)
  term.unicode.activeVersion = '11' // Without this Hangul widths are miscounted and the cursor drifts

  const fit = new FitAddon()
  term.loadAddon(fit)

  const search = new SearchAddon()
  term.loadAddon(search)

  const linkOptions: ILinkProviderOptions = {}
  /*
   * Test seam, like __term below: which cells a link covers is decided inside
   * the addon and drawn on a canvas, so the self-check cannot read it back.
   */
  if (import.meta.env.VITE_SELFCHECK === '1') {
    type Cell = { x: number; y: number }
    const seam = element as unknown as {
      __hoveredLink?: { text: string; range: { start: Cell; end: Cell } } | null
    }
    linkOptions.hover = (_event, text, range) => {
      seam.__hoveredLink = { text, range }
    }
    linkOptions.leave = () => {
      seam.__hoveredLink = null
    }
  }
  // Plain URLs in output. The addon's own opener is window.open; ours is main.
  term.loadAddon(new WebLinksAddon(openLink, linkOptions))

  /*
   * Decoration colours must be opaque #RRGGBB, so they can't ride the theme;
   * they come from tokens.css the same way the font stack does.
   */
  function searchOptions(caseSensitive: boolean, incremental = false) {
    const tokens = getComputedStyle(document.documentElement)
    const match = tokens.getPropertyValue('--search-match-bg').trim()
    const active = tokens.getPropertyValue('--search-match-active-bg').trim()
    return {
      caseSensitive,
      incremental,
      decorations: {
        matchBackground: match,
        matchOverviewRuler: match,
        activeMatchBackground: active,
        activeMatchColorOverviewRuler: active,
      },
    }
  }

  term.open(element)

  /*
   * Test seam: selections can't be made through the DOM on a canvas, so the
   * self-check reaches the instance directly.
   *
   * Gated on the self-check flag rather than DEV, because the check now runs
   * against a build. Nothing sets the flag for a release, so the branch folds
   * to false and goes away.
   */
  if (import.meta.env.VITE_SELFCHECK === '1') {
    ;(element as unknown as { __term?: Terminal }).__term = term
  }
  /*
   * Evidence gathering for the intermittent Korean double input: tap the IME
   * event stream and dump it the moment a double commit is detected. The
   * console is enough — `npm run dev` mirrors it to the terminal.
   */
  const imeTrace = new ImeTrace()
  const textarea = element.querySelector('textarea')
  if (textarea !== null) {
    textarea.addEventListener('keydown', (ev) => {
      imeTrace.record(
        performance.now(),
        'keydown',
        `keyCode=${ev.keyCode} key=${ev.key} isComposing=${ev.isComposing}`,
      )
    })
    // Capture, and before the guard: it stops the doubled compositionend dead,
    // and a trace that loses the event it exists to explain is worth nothing.
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend'] as const) {
      textarea.addEventListener(
        type,
        (ev) => {
          imeTrace.record(
            performance.now(),
            type,
            JSON.stringify((ev as CompositionEvent).data ?? ''),
          )
        },
        true,
      )
    }
    guardImeDoubleCommit(textarea)
    textarea.addEventListener('input', (ev) => {
      const { inputType, data, composed } = ev as InputEvent
      imeTrace.record(
        performance.now(),
        'input',
        `inputType=${inputType} data=${JSON.stringify(data)} composed=${composed}`,
      )
    })
  }
  term.onData((data) => {
    if (imeTrace.recordData(performance.now(), data)) {
      console.warn('[ime-trace] Hangul double commit detected', imeTrace.dump())
    }
    options.onInput(data)
  })

  // ── Vertical scrolling ───────────────────────────────

  let boost = lineSensitivity(options.appearance.scrollBoost)
  /** Outstanding movement in lines; fractional is fine. */
  let scrollTarget = 0
  let scrollRaf: number | null = null
  let lastWheelAt = 0
  let lastFrameAt = 0
  let burst = 1

  function glideScroll(now: number): void {
    // Baseline is one 60fps frame, corrected for the real interval.
    const dt = lastFrameAt === 0 ? FRAME_MS : Math.min(64, now - lastFrameAt)
    lastFrameAt = now

    const move = scrollTarget * glideFactor(dt)
    // xterm scrolls in whole lines; carry the remainder or slow rolls never move.
    const lines = move > 0 ? Math.floor(move) : Math.ceil(move)
    if (lines !== 0) {
      term.scrollLines(lines)
      scrollTarget -= lines
    } else {
      scrollTarget -= move
    }

    if (Math.abs(scrollTarget) < 0.5) {
      scrollTarget = 0
      scrollRaf = null
      lastFrameAt = 0
      return
    }
    scrollRaf = requestAnimationFrame(glideScroll)
  }

  element.addEventListener(
    'wheel',
    (event) => {
      /*
       * Not ours: a horizontal component or Shift belongs to the canvas, the
       * alternate screen has no scrollback, and mouse tracking wants the wheel
       * forwarded to the pty. Ask xterm for the state rather than re-deriving it.
       */
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) return
      if (term.buffer.active.type === 'alternate') return
      if (term.modes.mouseTrackingMode !== 'none') return
      if (event.deltaY === 0) return

      // Claim it before xterm's own handler, or the scroll happens twice.
      event.preventDefault()
      event.stopPropagation()

      const px = wheelPixels(event.deltaY, event.deltaMode)

      const now = performance.now()
      burst = nextBurst(burst, now - lastWheelAt)
      lastWheelAt = now

      // Pixels to lines.
      const lineHeight = Math.max(1, term.options.fontSize! * (term.options.lineHeight ?? 1))
      scrollTarget += (px / lineHeight) * boost * burst
      if (scrollRaf === null) scrollRaf = requestAnimationFrame(glideScroll)
    },
    { passive: false, capture: true },
  )

  // Copy-on-select: report once, on release.
  element.addEventListener('mouseup', () => {
    const selected = term.getSelection()
    if (selected !== '') options.onSelected?.(selected)
  })

  /*
   * Files dropped from a file manager arrive as their quoted paths, which is
   * what every terminal does with a drop — the program on the other end reads a
   * pty, and a pty carries bytes.
   *
   * Both handlers must cancel the default, or Chromium leaves the terminal and
   * opens the file as a page.
   */
  element.addEventListener('dragover', (event) => {
    event.preventDefault()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
  })

  element.addEventListener('drop', (event) => {
    event.preventDefault()
    const files = [...(event.dataTransfer?.files ?? [])]
    const paths = files.map((file) => api.pathForFile(file)).filter((path) => path !== '')
    // A drag from a browser carries no path; its text is the next best thing.
    const text =
      paths.length > 0
        ? `${paths.map(shellQuote).join(' ')} `
        : (event.dataTransfer?.getData('text/plain') ?? '')
    if (text === '') return
    term.focus()
    // Through paste, so it is bracketed and a newline in a name can't run.
    term.paste(text)
  })

  function stopScrollGlide(): void {
    if (scrollRaf === null) return
    cancelAnimationFrame(scrollRaf)
    scrollRaf = null
    scrollTarget = 0
    lastFrameAt = 0
  }

  let renderer: WebglAddon | null = null
  let frozen = false
  let queue: string[] = []
  let queued = 0
  let lastCols = term.cols
  let lastRows = term.rows
  let disposed = false

  function flushQueue(): void {
    if (queue.length === 0) return
    const data = queue.join('')
    queue = []
    queued = 0
    term.write(data)
  }

  /**
   * Fit the grid to the host, if that moves it.
   *
   * Which renderer is loaded changes the answer: WebGL rounds the cell to whole
   * device pixels and the DOM renderer does not, so the same font gives the two
   * different cell widths. Whoever swaps them has to refit.
   */
  function applySize(): void {
    if (disposed) return
    const proposed = fit.proposeDimensions()
    if (proposed === undefined) return
    const { cols, rows } = proposed
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) return
    if (cols === lastCols && rows === lastRows) return
    lastCols = cols
    lastRows = rows
    term.resize(cols, rows)
    options.onResize(cols, rows)
  }

  return {
    element,
    get cols() {
      return term.cols
    },
    get rows() {
      return term.rows
    },

    applyAppearance(appearance) {
      if (disposed) return
      term.options.theme = toXtermTheme(appearance.theme)
      term.options.fontFamily = fontStack(appearance.fontFamily)
      boost = lineSensitivity(appearance.scrollBoost)
      term.options.fontSize = appearance.fontSize
      term.options.lineHeight = appearance.lineHeight
      term.options.scrollback = appearance.scrollback
      // Font size changes the cell size, so cols/rows must be remeasured.
      this.setSize()
    },

    getSelection() {
      return disposed ? '' : term.getSelection()
    },

    paste(text) {
      if (!disposed) term.paste(text)
    },

    write(data) {
      if (disposed) return
      if (!frozen) {
        term.write(data)
        return
      }
      queue.push(data)
      queued += data.length
      // Dropping the front would cut an escape sequence; xterm's scrollback
      // already trims old output correctly.
      if (queued >= FROZEN_QUEUE_LIMIT) flushQueue()
    },

    setSize: applySize,

    focus() {
      if (!disposed) term.focus()
    },

    setFocused(focused) {
      if (disposed) return
      term.options.cursorBlink = focused
      if (!focused) term.blur()
    },

    findNext(query, caseSensitive, incremental = false) {
      if (disposed) return
      if (query === '') {
        search.clearDecorations()
        return
      }
      search.findNext(query, searchOptions(caseSensitive, incremental))
    },

    findPrevious(query, caseSensitive) {
      if (disposed || query === '') return
      search.findPrevious(query, searchOptions(caseSensitive))
    },

    clearSearch() {
      if (!disposed) search.clearDecorations()
    },

    onSearchResults(listener) {
      const subscription = search.onDidChangeResults((event) => {
        listener(event.resultIndex, event.resultCount)
      })
      return () => subscription.dispose()
    },

    freeze() {
      frozen = true
      // Freezing means no work at all in this pane.
      stopScrollGlide()
    },

    thaw() {
      if (!frozen) return
      frozen = false
      flushQueue()
      // With no queued output there is nothing to write, so ask for a repaint.
      term.refresh(0, term.rows - 1)
    },

    attachRenderer() {
      if (renderer !== null || disposed) return
      try {
        const webgl = new WebglAddon()
        // Dropping the addon falls back to the DOM renderer: slower, still drawing.
        webgl.onContextLoss(() => {
          console.warn(`[termspace] WebGL context lost, demoting to DOM renderer: ${options.paneId}`)
          webgl.dispose()
          renderer = null
          options.onRendererLost?.()
        })
        term.loadAddon(webgl)
        renderer = webgl
        // The cell just changed size under the grid; see applySize.
        applySize()
        // A fresh renderer starts blank and won't draw the existing buffer until
        // the next output arrives, so repaint once here.
        term.refresh(0, term.rows - 1)
      } catch (err) {
        // Attachment failure is survivable — carry on with the DOM renderer.
        console.warn(`[termspace] WebGL attach failed, continuing with DOM renderer: ${options.paneId}`, err)
        renderer = null
      }
    },

    detachRenderer() {
      if (renderer === null) return
      renderer.dispose()
      renderer = null
      applySize()
    },

    dispose() {
      if (disposed) return
      disposed = true
      stopScrollGlide()
      renderer?.dispose()
      renderer = null
      queue = []
      term.dispose()
      element.remove()
    },
  }
}
