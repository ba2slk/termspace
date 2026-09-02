/**
 * One panel shell: a body slot and its own rectangle. Knows nothing about
 * what goes inside.
 */
import type { Rect } from './layout-geometry'

/**
 * What a folded pane's bar says. The same three things an overview card carries,
 * because the question is the same one: what is in there, and does it want me?
 */
export interface FoldInfo {
  readonly title: string
  /** The foreground command, or empty where the shell is just sitting there. */
  readonly command: string
  /** This pane rang while you were looking elsewhere. */
  readonly wants: boolean
}

export interface PaneView {
  readonly element: HTMLElement
  readonly body: HTMLElement
  setFocused(focused: boolean): void
  /**
   * The title shown while the peek modifier is held. Empty means no label:
   * a pane nobody named has nothing to say.
   */
  setTitle(title: string): void
  setFrozen(frozen: boolean): void
  /** Drawn over its neighbours, at whatever rect it is then given. */
  setZoomed(zoomed: boolean): void
  /**
   * Folded to a bar: the terminal is hidden, not stopped, and the bar takes its
   * place. The rect still comes from the layout, so nothing here decides a size.
   */
  setFolded(folded: boolean, info: FoldInfo): void
  setRect(rect: Rect): void
}

export function createPaneView(paneId: string): PaneView {
  const element = document.createElement('section')
  element.className = 'panel pane'
  element.dataset['paneId'] = paneId

  // Body only — no title row, no badges.
  const body = document.createElement('div')
  body.className = 'pane__body'

  /*
   * The peek label. An overlay rather than a row: a header would take rows off
   * the terminal for something that is on screen only while a key is held.
   */
  const label = document.createElement('div')
  label.className = 'pane__label'
  label.hidden = true

  /*
   * The folded bar. Built once and left hidden: a pane is folded and unfolded
   * by the same key over and over, and rebuilding the row each time would put
   * DOM churn on a keystroke that promises to change nothing but the height.
   */
  const fold = document.createElement('div')
  fold.className = 'pane__fold'
  fold.hidden = true
  const dot = document.createElement('span')
  dot.className = 'pane__fold-dot'
  const foldTitle = document.createElement('span')
  foldTitle.className = 'pane__fold-title'
  const foldCommand = document.createElement('span')
  foldCommand.className = 'pane__fold-command'
  fold.append(dot, foldTitle, foldCommand)

  element.append(body, label, fold)

  let last: Rect | null = null
  let lastTitle: string | null = null

  return {
    element,
    body,
    setFocused(focused) {
      element.classList.toggle('pane--focused', focused)
    },
    setTitle(title) {
      if (title === lastTitle) return
      lastTitle = title
      label.textContent = title
      label.hidden = title === ''
    },
    setFrozen(frozen) {
      element.classList.toggle('pane--frozen', frozen)
    },
    setZoomed(zoomed) {
      element.classList.toggle('pane--zoomed', zoomed)
    },
    setFolded(folded, info) {
      element.classList.toggle('pane--folded', folded)
      fold.hidden = !folded
      if (!folded) return
      fold.classList.toggle('pane__fold--wants', info.wants)
      foldTitle.textContent = info.title
      foldCommand.textContent = info.command
    },
    setRect(rect) {
      // Round to keep borders crisp.
      const next = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
      if (
        last !== null &&
        next.x === last.x &&
        next.y === last.y &&
        next.width === last.width &&
        next.height === last.height
      ) {
        return
      }
      last = next
      element.style.left = `${next.x}px`
      element.style.top = `${next.y}px`
      element.style.width = `${next.width}px`
      element.style.height = `${next.height}px`
    },
  }
}
