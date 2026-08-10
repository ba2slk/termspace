/**
 * What fills the canvas before anything is open.
 *
 * It cannot tell you to pick a session from the list, because on a first run
 * there may be no list. What it can do is name the keys that get you moving,
 * and those come from the live bindings rather than a fixed string — the whole
 * point of the shortcuts tab is that they are yours to change.
 */
import { formatChord, type ActionId, type Bindings } from '../shared/keybindings'
import { createAppMark, MARK_CANVAS } from './app-mark'
import { t } from './i18n'

/**
 * In the order someone needs them: open a session, get the list back if it is
 * hidden, then the two moves the canvas exists for. Settings comes last because
 * it is the door to everything left out — a list long enough to read is a list
 * nobody reads.
 */
const ONBOARDING: readonly ActionId[] = [
  'goto-session',
  'toggle-sidebar',
  'add-column-right',
  'overview',
  'settings',
]

export interface EmptyCanvas {
  readonly el: HTMLElement
  setBindings(bindings: Bindings): void
  setHidden(hidden: boolean): void
}

export function createEmptyCanvas(): EmptyCanvas {
  const el = document.createElement('div')
  el.className = 'canvas-empty'

  const mark = createAppMark(MARK_CANVAS)
  mark.classList.add('canvas-empty__mark')

  // The only place the app names itself; the bar belongs to the session.
  const word = document.createElement('div')
  word.className = 'canvas-empty__word'
  word.textContent = t.firstRun.appName

  const keys = document.createElement('dl')
  keys.className = 'canvas-empty__keys'

  const chords = new Map<ActionId, HTMLElement>()
  for (const action of ONBOARDING) {
    const label = document.createElement('dt')
    label.textContent = t.keys[action]
    const chord = document.createElement('dd')
    chords.set(action, chord)
    keys.append(label, chord)
  }

  const more = document.createElement('p')
  more.className = 'canvas-empty__more'
  more.textContent = t.firstRun.moreKeys

  el.append(mark, word, keys, more)

  return {
    el,
    setBindings(bindings) {
      for (const [action, chord] of chords) {
        const bound = bindings[action]
        chord.textContent =
          bound.length === 0
            ? t.keys.unbound
            : bound.map((chord) => formatChord(chord)).join(' / ')
      }
    },
    setHidden(hidden) {
      el.hidden = hidden
    },
  }
}
