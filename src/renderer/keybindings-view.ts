/**
 * The Shortcuts tab of the settings screen.
 *
 * One row per action, and a row is edited by pressing the key itself rather
 * than typing its name — a chord is easier to perform than to spell.
 *
 * Nothing is refused. A chord the terminal normally owns still saves, with the
 * reason shown underneath: the user knows their own shell better than a rule
 * here does.
 */
import {
  ACTION_GROUPS,
  chordFromEvent,
  chordRisk,
  defaultBindingsFor,
  findConflicts,
  formatChord,
  isDefault,
  MAX_CHORDS,
  withChords,
  type ActionGroup,
  type ActionId,
  type Bindings,
} from '../shared/keybindings'
import { t } from './i18n'
import { IS_MAC } from './platform'

export interface KeybindingsPanel {
  readonly element: HTMLElement
  /**
   * Feed one keydown; true means the panel took it. Only true while recording,
   * when the whole keyboard belongs to the row being edited.
   */
  handleKey(event: KeyboardEvent): boolean
  /** Drop out of recording, e.g. when the settings screen closes. */
  cancelRecording(): void
  destroy(): void
}

export interface KeybindingsHooks {
  readonly bindings: () => Bindings
  readonly onChange: (next: Bindings) => void
}

const GROUP_LABEL: Readonly<Record<ActionGroup, string>> = {
  pane: t.keys.groupPane,
  layout: t.keys.groupLayout,
  terminal: t.keys.groupTerminal,
  app: t.keys.groupApp,
}

const RISK_TEXT = {
  'control-char': t.keys.riskControlChar,
  'shell-word': t.keys.riskShellWord,
  'plain-key': t.keys.riskPlainKey,
  'system-key': t.keys.riskSystemKey,
  'menu-owned': t.keys.riskMenuOwned,
} as const

/** Which chord slot is being recorded. `index` past the end means a new one. */
interface Recording {
  readonly id: ActionId
  readonly index: number
}

export function createKeybindingsPanel(hooks: KeybindingsHooks): KeybindingsPanel {
  const element = document.createElement('div')
  element.className = 'keys'

  let query = ''
  let recording: Recording | null = null

  function commit(next: Bindings): void {
    recording = null
    hooks.onChange(next)
    render()
  }

  function setChord(id: ActionId, index: number, chord: string): void {
    const chords = [...hooks.bindings()[id]]
    if (index < chords.length) chords[index] = chord
    else chords.push(chord)
    // The same chord twice on one action would draw two identical chips.
    commit(withChords(hooks.bindings(), id, [...new Set(chords)]))
  }

  function removeChord(id: ActionId, index: number): void {
    const chords = hooks.bindings()[id].filter((_, i) => i !== index)
    commit(withChords(hooks.bindings(), id, chords))
  }

  function matches(id: ActionId, bindings: Bindings): boolean {
    if (query === '') return true
    const needle = query.toLowerCase()
    if (t.keys[id].toLowerCase().includes(needle)) return true
    /*
     * Searching by the key itself: "alt+m" finds the map. Chips are drawn with
     * spaces around the plus, and nobody types those, so both sides lose them.
     */
    const bare = needle.replace(/\s+/g, '')
    return bindings[id].some((chord) =>
      formatChord(chord, IS_MAC).toLowerCase().replace(/\s+/g, '').includes(bare),
    )
  }

  function chip(id: ActionId, chord: string, index: number): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'keys__chip'

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'keys__chord'
    button.textContent = formatChord(chord, IS_MAC)
    button.addEventListener('click', () => {
      recording = { id, index }
      render()
    })

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'keys__remove'
    remove.textContent = '✕'
    remove.title = t.keys.remove
    remove.addEventListener('click', () => removeChord(id, index))

    wrap.append(button, remove)
    return wrap
  }

  function row(id: ActionId, bindings: Bindings, conflicts: ReadonlyMap<string, readonly ActionId[]>): HTMLElement {
    const rowEl = document.createElement('div')
    rowEl.className = 'keys__row'
    rowEl.dataset['action'] = id

    const label = document.createElement('span')
    label.className = 'keys__label'
    label.textContent = t.keys[id]

    const chords = document.createElement('div')
    chords.className = 'keys__chords'

    const isRecordingHere = recording !== null && recording.id === id
    const list = bindings[id]

    list.forEach((chord, index) => {
      if (isRecordingHere && recording?.index === index) chords.append(pending())
      else chords.append(chip(id, chord, index))
    })

    if (isRecordingHere && (recording?.index ?? 0) >= list.length) chords.append(pending())
    else if (list.length === 0 && !isRecordingHere) {
      const none = document.createElement('span')
      none.className = 'keys__unbound'
      none.textContent = t.keys.unbound
      chords.append(none)
    }

    if (!isRecordingHere && list.length < MAX_CHORDS) {
      const add = document.createElement('button')
      add.type = 'button'
      add.className = 'keys__add'
      add.textContent = '+'
      add.title = t.keys.add
      add.addEventListener('click', () => {
        recording = { id, index: list.length }
        render()
      })
      chords.append(add)
    }

    // Nothing to restore when the row is already stock, so no button either.
    if (!isDefault(bindings, id, IS_MAC)) {
      const reset = document.createElement('button')
      reset.type = 'button'
      reset.className = 'keys__reset'
      reset.textContent = '↺'
      reset.title = t.keys.resetRow
      reset.addEventListener('click', () => commit(withChords(bindings, id, defaultBindingsFor(IS_MAC)[id])))
      chords.append(reset)
    }

    rowEl.append(label, chords)

    const warnings = document.createElement('div')
    warnings.className = 'keys__warnings'
    for (const chord of list) {
      const risk = chordRisk(chord, IS_MAC, id)
      if (risk !== null) warnings.append(warning(`${formatChord(chord, IS_MAC)} — ${RISK_TEXT[risk]}`))
      const claimants = conflicts.get(chord)
      if (claimants !== undefined) {
        const others = claimants.filter((other) => other !== id).map((other) => t.keys[other])
        warnings.append(warning(`${formatChord(chord, IS_MAC)} — ${t.keys.conflict(others.join(', '))}`))
      }
    }
    if (warnings.childElementCount > 0) rowEl.append(warnings)

    return rowEl
  }

  function pending(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'keys__chord keys__chord--recording'
    span.textContent = t.keys.recording
    return span
  }

  function warning(text: string): HTMLElement {
    const line = document.createElement('small')
    line.className = 'keys__warning'
    line.textContent = text
    return line
  }

  /*
   * The search field outlives every redraw.
   *
   * Rebuilding it with the list replaced the element the IME was composing
   * into, and a Hangul syllable takes several keystrokes to assemble — the
   * composition died halfway each time. Only the list is ever replaced.
   */
  const bar = document.createElement('div')
  bar.className = 'keys__bar'

  const search = document.createElement('input')
  search.type = 'search'
  search.className = 'keys__search'
  search.placeholder = t.keys.searchPlaceholder

  const resetAll = document.createElement('button')
  resetAll.type = 'button'
  resetAll.className = 'button keys__reset-all'
  resetAll.textContent = t.keys.resetAll
  resetAll.addEventListener('click', () => commit(defaultBindingsFor(IS_MAC)))

  bar.append(search, resetAll)

  const list = document.createElement('div')
  list.className = 'keys__list'

  const note = document.createElement('p')
  note.className = 'settings__note'
  note.textContent = t.keys.note

  element.append(bar, list, note)

  function applyQuery(): void {
    const next = search.value.trim()
    if (next === query) return
    query = next
    render()
  }

  search.addEventListener('input', (event) => {
    // Half-built jamo match nothing, so filtering mid-syllable would blank the
    // list on every keystroke and only settle once the syllable lands.
    if ((event as InputEvent).isComposing) return
    applyQuery()
  })
  search.addEventListener('compositionend', () => applyQuery())

  function render(): void {
    const bindings = hooks.bindings()
    const conflicts = findConflicts(bindings)

    resetAll.disabled = ACTION_GROUPS.every(({ ids }) => ids.every((id) => isDefault(bindings, id, IS_MAC)))

    const drawn: HTMLElement[] = []
    for (const { group, ids } of ACTION_GROUPS) {
      const visible = ids.filter((id) => matches(id, bindings))
      if (visible.length === 0) continue
      const heading = document.createElement('h4')
      heading.className = 'keys__group'
      heading.textContent = GROUP_LABEL[group]
      drawn.push(heading, ...visible.map((id) => row(id, bindings, conflicts)))
    }

    if (drawn.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'keys__empty'
      empty.textContent = t.keys.noResults
      drawn.push(empty)
    }

    list.replaceChildren(...drawn)
  }

  render()

  return {
    element,

    handleKey(event) {
      if (recording === null) return false
      // Esc leaves the row as it was; the settings screen must not close.
      if (event.key === 'Escape') {
        recording = null
        render()
        return true
      }
      const chord = chordFromEvent(event, IS_MAC)
      // A lone modifier is the start of a chord, not one — keep waiting.
      if (chord === null) return true
      setChord(recording.id, recording.index, chord)
      return true
    },

    cancelRecording() {
      if (recording === null) return
      recording = null
      render()
    },

    destroy() {
      element.remove()
    },
  }
}
