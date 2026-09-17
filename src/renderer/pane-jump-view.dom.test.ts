import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JumpEntry } from './pane-jump-model'
import { createPaneJumpView, type PaneJumpHooks } from './pane-jump-view'

let host: HTMLElement

const BLANK = { command: '', windowTitle: '', focused: false, wants: false }
const ENTRIES: JumpEntry[] = [
  { ...BLANK, id: 'a', name: 'dev server', column: 1, focused: true },
  { ...BLANK, id: 'b', name: 'network dash', column: 2, wants: true },
  { ...BLANK, id: 'c', name: 'editor', column: 2 },
]

function hooks(over: Partial<PaneJumpHooks> = {}) {
  return {
    entries: vi.fn(() => ENTRIES),
    commands: vi.fn(async () => ({}) as Record<string, string | null>),
    titles: vi.fn(async () => ({}) as Record<string, string | null>),
    onJump: vi.fn<(paneId: string) => void>(),
    onClose: vi.fn<() => void>(),
    ...over,
  } satisfies PaneJumpHooks
}

const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.pane-jump__row')]
const input = (): HTMLInputElement => host.querySelector('.pane-jump__input')!

function type(query: string): void {
  input().value = query
  input().dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>'
  host = document.getElementById('host')!
})

describe('createPaneJumpView', () => {
  it('renders one row per entry, in canvas order', () => {
    createPaneJumpView(host, hooks()).open()
    expect(rows().map((row) => row.dataset.paneId)).toEqual(['a', 'b', 'c'])
  })

  it('typing re-ranks and selects the first row', () => {
    createPaneJumpView(host, hooks()).open()
    type('nrd')
    expect(rows()).toHaveLength(1)
    expect(rows()[0]?.dataset.paneId).toBe('b')
    expect(rows()[0]?.classList.contains('pane-jump__row--selected')).toBe(true)
  })

  it('shows the empty line when nothing matches', () => {
    createPaneJumpView(host, hooks()).open()
    type('zzz')
    expect(rows()).toHaveLength(0)
    expect(host.querySelector('.pane-jump__empty')).not.toBeNull()
  })

  it('close removes the panel and hands the keyboard back', () => {
    const h = hooks()
    const view = createPaneJumpView(host, h)
    view.open()
    view.close()
    expect(host.querySelector('.pane-jump')).toBeNull()
    expect(view.isOpen).toBe(false)
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })

  it('opening twice keeps one panel', () => {
    const view = createPaneJumpView(host, hooks())
    view.open()
    view.open()
    expect(host.querySelectorAll('.pane-jump')).toHaveLength(1)
    expect(view.isOpen).toBe(true)
  })
})
