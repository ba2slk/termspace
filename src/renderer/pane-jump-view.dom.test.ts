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

/** The hooks resolve one microtask deep; two flushes cover the re-render. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
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

  it('marks the panel while a query is typed, and only then', () => {
    createPaneJumpView(host, hooks()).open()
    const panel = host.querySelector('.pane-jump')!
    expect(panel.classList.contains('pane-jump--querying')).toBe(false)
    type('nrd')
    expect(panel.classList.contains('pane-jump--querying')).toBe(true)
    type('   ')
    expect(panel.classList.contains('pane-jump--querying')).toBe(false)
  })

  it('marks the typed letters in the row it ranked', () => {
    createPaneJumpView(host, hooks()).open()
    type('nrd')
    const marks = [...rows()[0]!.querySelectorAll('.pane-jump__match')]
    expect(marks.map((mark) => mark.textContent).join('')).toBe('nrd')
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

  it('fills the sub line once commands and titles answer', async () => {
    createPaneJumpView(
      host,
      hooks({
        commands: vi.fn(async () => ({ a: 'npm run dev', c: 'nvim' })),
        titles: vi.fn(async () => ({ c: 'layout-model.ts' })),
      }),
    ).open()
    await settle()
    const subs = rows().map((row) => row.querySelector('.pane-jump__sub')?.textContent)
    expect(subs).toEqual(['npm run dev', '', 'nvim · layout-model.ts'])
  })

  it('ignores answers that arrive after close', async () => {
    const view = createPaneJumpView(host, hooks({ commands: vi.fn(async () => ({ a: 'late' })) }))
    view.open()
    view.close()
    await settle()
    expect(host.querySelector('.pane-jump')).toBeNull()
    expect(view.isOpen).toBe(false)
  })

  it('opening twice keeps one panel', () => {
    const view = createPaneJumpView(host, hooks())
    view.open()
    view.open()
    expect(host.querySelectorAll('.pane-jump')).toHaveLength(1)
    expect(view.isOpen).toBe(true)
  })

  it('dims the session behind the panel, with one scrim under it', () => {
    const view = createPaneJumpView(host, hooks())
    view.open()
    view.open()
    const scrims = host.querySelectorAll('.pane-jump-scrim')
    expect(scrims).toHaveLength(1)
    expect(scrims[0]?.nextElementSibling).toBe(host.querySelector('.pane-jump'))
  })

  it.each(['close', 'destroy'] as const)('%s takes the scrim with the panel', (how) => {
    const view = createPaneJumpView(host, hooks())
    view.open()
    view[how]()
    expect(host.querySelector('.pane-jump-scrim')).toBeNull()
    expect(host.querySelector('.pane-jump')).toBeNull()
  })
})
