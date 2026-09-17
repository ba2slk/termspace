/**
 * The pane jump panel: an input over the canvas, and the panes a few typed
 * letters mean. Drawing only; keys and pointer are wired by the caller.
 */
import { t } from './i18n'
import { isBlankQuery, rankEntries, type JumpEntry } from './pane-jump-model'
import { buildEmptyRow, buildRow } from './pane-jump-row'

export interface PaneJumpHooks {
  /** Canvas order. command and windowTitle may be '' — they are filled from the two below. */
  readonly entries: () => readonly JumpEntry[]
  readonly commands: (paneIds: readonly string[]) => Promise<Record<string, string | null>>
  readonly titles: (paneIds: readonly string[]) => Promise<Record<string, string | null>>
  readonly onJump: (paneId: string) => void
  /**
   * The panel closed itself without a jump (Escape, a click outside, toggle);
   * the caller hands the keyboard back to the pane. `close()` and `destroy()`
   * are silent: whoever called them already knows.
   */
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

  // A sibling of the panel, not a child: the panel's own pointer handling asks
  // closest('.pane-jump'), and a press on the scrim has to read as outside.
  const scrim = document.createElement('div')
  scrim.className = 'pane-jump-scrim'

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
  // Bumped on every open and close, so an answer from a past open cannot paint.
  let generation = 0
  // The pane the selection sits on, not its row number: a late sub line re-ranks nothing,
  // but an entry closing under the panel would shift every index below it.
  let selectedId: string | null = null
  const commands = new Map<string, string>()
  const titles = new Map<string, string>()

  /** The panes as the canvas has them, with whatever the two hooks have answered. */
  function currentEntries(): JumpEntry[] {
    return hooks.entries().map((entry) => ({
      ...entry,
      command: commands.get(entry.id) ?? entry.command,
      windowTitle: titles.get(entry.id) ?? entry.windowTitle,
    }))
  }

  function render(): void {
    // Whitespace alone is not a query; the model decides that, so both agree.
    element.classList.toggle('pane-jump--querying', !isBlankQuery(input.value))
    const results = rankEntries(input.value, currentEntries())
    list.textContent = ''
    if (results.length === 0) {
      selectedId = null
      list.append(buildEmptyRow())
      return
    }
    // The selected pane keeps the highlight while it is listed; otherwise the best row takes it.
    const at = Math.max(
      results.findIndex((result) => result.entry.id === selectedId),
      0,
    )
    selectedId = results[at]?.entry.id ?? null
    results.forEach((result, index) => list.append(buildRow(result, index === at)))
  }

  function move(delta: number): void {
    const items = [...list.querySelectorAll<HTMLElement>('.pane-jump__row')]
    if (items.length === 0) return
    const from = Math.max(
      items.findIndex((item) => item.dataset.paneId === selectedId),
      0,
    )
    const next = (from + delta + items.length) % items.length
    items.forEach((item, index) =>
      item.classList.toggle('pane-jump__row--selected', index === next),
    )
    const row = items[next]
    selectedId = row?.dataset.paneId ?? null
    // happy-dom has no scrollIntoView.
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  }

  function jump(paneId: string): void {
    // Close first: the caller moves focus, and a teardown after that would take it back.
    teardown()
    hooks.onJump(paneId)
  }

  function dismiss(): void {
    teardown()
    hooks.onClose()
  }

  /** One round trip per open, for every pane at once. */
  function fill(): void {
    const ids = hooks.entries().map((entry) => entry.id)
    const mine = generation
    const absorb = (into: Map<string, string>) => (answer: Record<string, string | null>) => {
      if (mine !== generation) return
      for (const [id, value] of Object.entries(answer)) {
        if (value !== null && value !== '') into.set(id, value)
      }
      render()
    }
    void hooks.commands(ids).then(absorb(commands))
    void hooks.titles(ids).then(absorb(titles))
  }

  input.addEventListener('input', () => {
    // A new letter re-ranks everything, so the best row takes the highlight back.
    selectedId = null
    render()
  })

  input.addEventListener('keydown', (event) => {
    // An open Hangul composition uses the arrows and Enter itself.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (event.isComposing) return
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Enter') {
      if (event.isComposing) return
      event.preventDefault()
      if (selectedId !== null) jump(selectedId)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      dismiss()
    }
  })

  function teardown(): void {
    opened = false
    generation += 1
    element.remove()
    scrim.remove()
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
      generation += 1
      commands.clear()
      titles.clear()
      input.value = ''
      selectedId = null
      host.append(scrim, element)
      render()
      input.focus()
      fill()
    },
    close() {
      if (opened) teardown()
    },
    toggle() {
      if (opened) dismiss()
      else this.open()
    },
    destroy() {
      teardown()
    },
  }
}
