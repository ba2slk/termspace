/**
 * One panel shell: a body slot and its own rectangle. Knows nothing about
 * what goes inside.
 */
import type { Rect } from './layout-geometry'

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

  element.append(body, label)

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
