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
      list.append(buildEmptyRow())
      return
    }
    // Typing resets the selection: the best row after the new letter is row 0.
    results.forEach((result, index) => list.append(buildRow(result, index === 0)))
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

  input.addEventListener('input', render)

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
      host.append(scrim, element)
      render()
      input.focus()
      fill()
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
