/*
 * The panel on mac. Its own file because the platform is read once as the
 * module loads, so one process can only ever see one platform.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BINDINGS_MAC, type ActionId, type Bindings } from '../shared/keybindings'
import { t } from './i18n'
import type { KeybindingsPanel } from './keybindings-view'

vi.stubGlobal('termspace', { platform: 'darwin' })

const { createKeybindingsPanel } = await import('./keybindings-view')

let bindings: Bindings
let panel: KeybindingsPanel

beforeEach(() => {
  document.body.innerHTML = ''
  bindings = DEFAULT_BINDINGS_MAC
  panel = createKeybindingsPanel({
    bindings: () => bindings,
    onChange: (next) => {
      bindings = next
    },
  })
  document.body.append(panel.element)
})

const row = (id: ActionId): HTMLElement =>
  panel.element.querySelector<HTMLElement>(`.keys__row[data-action="${id}"]`)!

describe('the keys the Edit menu owns', () => {
  it('shows copy and paste, and says they cannot be changed', () => {
    for (const [id, chord] of [
      ['copy', '⌘ + C'],
      ['paste', '⌘ + V'],
    ] as const) {
      expect(row(id).querySelector('.keys__chord--fixed')?.textContent).toBe(chord)
      expect(row(id).textContent).toContain(t.keys.fixedByMenu)
    }
  })

  it('offers nothing to press on those two rows', () => {
    for (const id of ['copy', 'paste'] as const) {
      expect(row(id).querySelectorAll('button')).toHaveLength(0)
    }
  })

  it('leaves every other row editable', () => {
    expect(row('overview').querySelector('.keys__remove')).not.toBeNull()
    expect(row('overview').querySelector('.keys__add')).not.toBeNull()
  })
})
