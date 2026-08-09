/**
 * Brief transient notice.
 *
 * Used for things that happen somewhere invisible — the clipboard shows
 * nothing until you paste. Sits in a corner: this fires hundreds of times a
 * day, and anything centred would be an interruption rather than a notice.
 */
const VISIBLE_MS = 1100

export interface Toast {
  show(message: string): void
  destroy(): void
}

export function createToast(host: HTMLElement): Toast {
  const element = document.createElement('div')
  element.className = 'toast'
  element.hidden = true
  // Announced to screen readers without stealing their place.
  element.setAttribute('role', 'status')
  element.setAttribute('aria-live', 'polite')
  host.append(element)

  let timer: number | null = null

  return {
    show(message) {
      element.textContent = message
      element.hidden = false
      // Restart the timer, so an earlier one can't cut the latest notice short.
      if (timer !== null) clearTimeout(timer)
      // Cancel a fade already in progress.
      element.classList.remove('toast--leaving')
      timer = window.setTimeout(() => {
        element.classList.add('toast--leaving')
        timer = window.setTimeout(() => {
          element.hidden = true
          element.classList.remove('toast--leaving')
          timer = null
        }, 200)
      }, VISIBLE_MS)
    },

    destroy() {
      if (timer !== null) clearTimeout(timer)
      element.remove()
    },
  }
}
