import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACTION_IDS,
  DEFAULT_BINDINGS,
  withChords,
  type ActionId,
  type Bindings,
} from '../shared/keybindings'
import { t } from './i18n'
import type { KeybindingsPanel } from './keybindings-view'

/*
 * The panel spells its chords for the platform, read from the bridge as the
 * module loads — so the stub has to be on window before the import.
 */
vi.stubGlobal('termspace', { platform: 'linux' })

const { createKeybindingsPanel } = await import('./keybindings-view')

let bindings: Bindings
let panel: KeybindingsPanel
let onChange: (next: Bindings) => void

beforeEach(() => {
  document.body.innerHTML = ''
  bindings = DEFAULT_BINDINGS
  onChange = vi.fn<(next: Bindings) => void>((next) => {
    bindings = next
  })
  panel = createKeybindingsPanel({ bindings: () => bindings, onChange })
  document.body.append(panel.element)
})

const row = (id: ActionId): HTMLElement =>
  panel.element.querySelector<HTMLElement>(`.keys__row[data-action="${id}"]`)!

const chords = (id: ActionId): string[] =>
  [...row(id).querySelectorAll('.keys__chord')].map((el) => el.textContent ?? '')

const press = (code: string, mods: Partial<KeyboardEventInit> = {}): boolean =>
  panel.handleKey(new KeyboardEvent('keydown', { code, ...mods }))

describe('the list', () => {
  it('shows every action, grouped', () => {
    expect(panel.element.querySelectorAll('.keys__row')).toHaveLength(ACTION_IDS.length)
    expect(panel.element.querySelectorAll('.keys__group')).toHaveLength(4)
  })

  it('shows the chords as keys, not codes', () => {
    expect(chords('focus-left')).toEqual(['Alt + ←'])
    expect(chords('resize-left')).toEqual(['Alt + U', 'Ctrl + Alt + ←'])
    expect(chords('goto-session')).toEqual(['Alt + 1~9'])
  })
})

describe('recording', () => {
  it('ignores keys until a chord is being recorded', () => {
    expect(press('KeyX', { altKey: true })).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('replaces the chord that was clicked', () => {
    row('overview').querySelector<HTMLButtonElement>('.keys__chord')!.click()
    expect(row('overview').querySelector('.keys__chord--recording')?.textContent).toBe(
      t.keys.recording,
    )

    expect(press('Space', { altKey: true })).toBe(true)
    expect(chords('overview')).toEqual(['Alt + Space'])
    expect(onChange).toHaveBeenCalledWith(withChords(DEFAULT_BINDINGS, 'overview', ['Alt+Space']))
  })

  it('adds a second chord without losing the first', () => {
    row('overview').querySelector<HTMLButtonElement>('.keys__add')!.click()
    press('KeyM', { ctrlKey: true, shiftKey: true })
    expect(chords('overview')).toEqual(['Alt + M', 'Ctrl + Shift + M'])
  })

  it('waits through a bare modifier rather than binding it', () => {
    row('overview').querySelector<HTMLButtonElement>('.keys__chord')!.click()
    expect(press('ShiftLeft', { shiftKey: true })).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    expect(row('overview').querySelector('.keys__chord--recording')).not.toBeNull()
  })

  it('takes Esc for itself and leaves the row alone', () => {
    row('overview').querySelector<HTMLButtonElement>('.keys__chord')!.click()
    expect(press('Escape', { key: 'Escape' } as Partial<KeyboardEventInit>)).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    expect(chords('overview')).toEqual(['Alt + M'])
    // And the next key is no longer the panel's.
    expect(press('KeyX', { altKey: true })).toBe(false)
  })

  it('stops recording when told to', () => {
    row('overview').querySelector<HTMLButtonElement>('.keys__chord')!.click()
    panel.cancelRecording()
    expect(press('KeyX', { altKey: true })).toBe(false)
  })
})

describe('removing and restoring', () => {
  it('leaves an action with no shortcut at all', () => {
    row('overview').querySelector<HTMLButtonElement>('.keys__remove')!.click()
    expect(chords('overview')).toEqual([])
    expect(row('overview').querySelector('.keys__unbound')?.textContent).toBe(t.keys.unbound)
  })

  it('offers a reset only once the row differs', () => {
    expect(row('overview').querySelector('.keys__reset')).toBeNull()
    row('overview').querySelector<HTMLButtonElement>('.keys__remove')!.click()
    row('overview').querySelector<HTMLButtonElement>('.keys__reset')!.click()
    expect(chords('overview')).toEqual(['Alt + M'])
  })

  it('restores everything at once', () => {
    row('overview').querySelector<HTMLButtonElement>('.keys__remove')!.click()
    panel.element.querySelector<HTMLButtonElement>('.keys__reset-all')!.click()
    expect(bindings).toEqual(DEFAULT_BINDINGS)
  })
})

describe('warnings', () => {
  it('names the other action when a chord is claimed twice', () => {
    row('overview').querySelector<HTMLButtonElement>('.keys__chord')!.click()
    press('KeyS', { altKey: true })
    const text = row('overview').textContent ?? ''
    expect(text).toContain(t.keys['toggle-sidebar'])
    // Both rows carry the warning: either one can be the mistake.
    expect(row('toggle-sidebar').querySelector('.keys__warning')).not.toBeNull()
  })

  it('says what the terminal would have done with the key', () => {
    row('overview').querySelector<HTMLButtonElement>('.keys__chord')!.click()
    press('KeyD', { ctrlKey: true })
    expect(row('overview').textContent).toContain(t.keys.riskControlChar)
  })

  it('saves the risky chord anyway', () => {
    row('overview').querySelector<HTMLButtonElement>('.keys__chord')!.click()
    press('KeyD', { ctrlKey: true })
    expect(chords('overview')).toEqual(['Ctrl + D'])
  })
})

describe('search', () => {
  const field = (): HTMLInputElement =>
    panel.element.querySelector<HTMLInputElement>('.keys__search')!

  const type = (text: string): void => {
    field().value = text
    field().dispatchEvent(new Event('input'))
  }

  it('filters by what the action is called', () => {
    type(t.keys.overview)
    expect(panel.element.querySelectorAll('.keys__row')).toHaveLength(1)
  })

  it('filters by the chord itself', () => {
    type('ctrl+shift')
    const shown = [...panel.element.querySelectorAll<HTMLElement>('.keys__row')].map(
      (el) => el.dataset['action'],
    )
    expect(shown).toContain('copy')
    expect(shown).not.toContain('focus-left')
  })

  it('says so when nothing matches', () => {
    type('zzzz')
    expect(panel.element.querySelector('.keys__empty')?.textContent).toBe(t.keys.noResults)
  })
})

describe('search — Korean input', () => {
  const field = (): HTMLInputElement =>
    panel.element.querySelector<HTMLInputElement>('.keys__search')!

  it('keeps the very same field across a redraw', () => {
    // Replacing it mid-syllable is what broke Hangul composition.
    const before = field()
    before.value = 'pane'
    before.dispatchEvent(new Event('input'))
    expect(field()).toBe(before)
    // And a redraw from elsewhere leaves it alone too.
    panel.element.querySelector<HTMLButtonElement>('.keys__reset-all')!.click()
    expect(field()).toBe(before)
  })

  it('holds off filtering until the syllable lands', () => {
    // Mid-composition the field holds half a syllable, which matches nothing.
    field().value = t.keys.overview.slice(0, 3)
    field().dispatchEvent(new InputEvent('input', { isComposing: true }))
    expect(panel.element.querySelectorAll('.keys__row')).toHaveLength(ACTION_IDS.length)

    field().value = t.keys.overview
    field().dispatchEvent(new InputEvent('input', { isComposing: true }))
    field().dispatchEvent(new CompositionEvent('compositionend'))
    expect(panel.element.querySelectorAll('.keys__row')).toHaveLength(1)
  })
})
