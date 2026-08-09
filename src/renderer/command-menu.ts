/**
 * The command menu behind the ☰ button.
 *
 * Listing names alongside shortcuts puts discovery and fluency in one place:
 * click at first, move to the keyboard later.
 */
export interface CommandItem {
  readonly label: string
  /** Shortcut hint; omitted for menu-only commands. */
  readonly hint?: string
  readonly separatorBefore?: boolean
  readonly disabled?: boolean
  /** Irreversible commands carry colour, so they can't be picked by accident. */
  readonly danger?: boolean
  readonly run: () => void
}

/** Anchor: below an element, or at a point for a right-click menu. */
export type MenuAnchor = HTMLElement | { readonly x: number; readonly y: number }

export interface CommandMenu {
  open(anchor: MenuAnchor, items: readonly CommandItem[]): void
  close(): void
  readonly isOpen: boolean
  destroy(): void
}

export function createCommandMenu(): CommandMenu {
  const menu = document.createElement('div')
  menu.className = 'command-menu'
  menu.hidden = true
  menu.setAttribute('role', 'menu')

  let onClosed: (() => void) | null = null

  function close(): void {
    if (menu.hidden) return
    menu.hidden = true
    menu.replaceChildren()
    const callback = onClosed
    onClosed = null
    callback?.()
  }

  // Close on outside mousedown. The bar's buttons stop their own, so toggling works.
  function onDocumentMouseDown(event: MouseEvent): void {
    if (!menu.hidden && !menu.contains(event.target as Node)) close()
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (menu.hidden) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    // While open, shortcuts must not leak through to the session.
    event.stopPropagation()
  }

  document.addEventListener('mousedown', onDocumentMouseDown)
  window.addEventListener('keydown', onKeyDown, true)
  document.body.append(menu)

  return {
    get isOpen() {
      return !menu.hidden
    },

    open(anchor, items) {
      menu.replaceChildren()
      for (const item of items) {
        if (item.separatorBefore === true) {
          const line = document.createElement('div')
          line.className = 'command-menu__separator'
          menu.append(line)
        }
        const button = document.createElement('button')
        button.type = 'button'
        button.className =
          item.danger === true ? 'command-menu__item command-menu__item--danger' : 'command-menu__item'
        button.setAttribute('role', 'menuitem')
        button.disabled = item.disabled === true

        const label = document.createElement('span')
        label.textContent = item.label
        button.append(label)

        // An unbound action reports an empty chord: no hint rather than a gap.
        if (item.hint !== undefined && item.hint !== '') {
          const hint = document.createElement('span')
          hint.className = 'command-menu__hint'
          hint.textContent = item.hint
          button.append(hint)
        }

        button.addEventListener('click', () => {
          close()
          item.run()
        })
        menu.append(button)
      }

      menu.hidden = false
      // Anchored below an element, or at the click point.
      const at =
        anchor instanceof HTMLElement
          ? (() => {
              const box = anchor.getBoundingClientRect()
              return { left: box.left, top: box.bottom + 4 }
            })()
          : { left: anchor.x, top: anchor.y }

      // Keep it on screen — a right-click can land anywhere.
      const margin = 8
      const width = menu.offsetWidth
      const height = menu.offsetHeight
      menu.style.left = `${String(Math.max(margin, Math.min(at.left, window.innerWidth - width - margin)))}px`
      menu.style.top = `${String(Math.max(margin, Math.min(at.top, window.innerHeight - height - margin)))}px`
    },

    close,

    destroy() {
      document.removeEventListener('mousedown', onDocumentMouseDown)
      window.removeEventListener('keydown', onKeyDown, true)
      menu.remove()
    },
  }
}
