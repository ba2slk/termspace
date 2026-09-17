/**
 * The pane jump panel: an input over the canvas, and the panes a few typed
 * letters mean. Drawing only; keys and pointer are wired by the caller.
 */
import { t } from './i18n'
import { rankEntries, type JumpEntry } from './pane-jump-model'
import { buildEmptyRow, buildRow } from './pane-jump-row'

export interface PaneJumpHooks {
  /** Canvas order. command and windowTitle may be '' — they are filled from the two below. */
  readonly entries: () => readonly JumpEntry[]
  readonly commands: (paneIds: readonly string[]) => Promise<Record<string, string | null>>
  readonly titles: (paneIds: readonly string[]) => Promise<Record<string, string | null>>
  readonly onJump: (paneId: string) => void
  /** Closed without a jump; the caller hands the keyboard back to the pane. */
  readonly onClose: () => void
}

export interface PaneJumpView {
  readonly isOpen: boolean
  open(): void
  close(): void
  toggle(): void
  destroy(): void
}

export function createPaneJumpView(host: HTMLElement, hooks: PaneJumpHooks): PaneJumpView {
  const element = document.createElement('div')
  element.className = 'pane-jump'
  element.setAttribute('role', 'dialog')

  const input = document.createElement('input')
  input.className = 'pane-jump__input'
  input.type = 'text'
  input.placeholder = t.paneJump.placeholder
  input.spellcheck = false

  const list = document.createElement('ul')
  list.className = 'pane-jump__list'
  list.setAttribute('role', 'listbox')

  const legend = document.createElement('div')
  legend.className = 'pane-jump__legend'
  for (const hint of t.paneJump.keys) {
    const item = document.createElement('span')
    item.className = 'pane-jump__hint'
    item.textContent = `${hint.key} ${hint.label}`
    legend.append(item)
  }

  element.append(input, list, legend)

  let opened = false

  function render(): void {
    const results = rankEntries(input.value, hooks.entries())
    list.textContent = ''
    if (results.length === 0) {
      list.append(buildEmptyRow())
      return
    }
    // Typing resets the selection: the best row after the new letter is row 0.
    results.forEach((result, index) => list.append(buildRow(result, index === 0)))
  }

  input.addEventListener('input', render)

  function teardown(): void {
    opened = false
    element.remove()
  }

  return {
    get isOpen() {
      return opened
    },
    open() {
      if (opened) {
        input.focus()
        input.select()
        return
      }
      opened = true
      input.value = ''
      host.append(element)
      render()
      input.focus()
    },
    close() {
      if (!opened) return
      teardown()
      hooks.onClose()
    },
    toggle() {
      if (opened) this.close()
      else this.open()
    },
    destroy() {
      teardown()
    },
  }
}
