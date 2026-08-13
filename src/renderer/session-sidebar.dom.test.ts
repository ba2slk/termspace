import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionSidebar, type SidebarHooks } from './session-sidebar'
import type { SessionSummary } from '../shared/protocol'

function summary(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'work',
    name: 'work',
    file: '/s/work.yaml',
    paneCount: 2,
    createdMs: 0,
    error: null,
    ...over,
  }
}

const hooks = (): SidebarHooks => ({
  onOpen: vi.fn(),
  onClose: vi.fn(),
  onCreateExample: vi.fn(),
  onRefresh: vi.fn(),
  onWidthChange: vi.fn(),
  gotoHint: (index: number) => `Alt+${String(index + 1)}`,
  onCreateBlank: vi.fn(),
  onContextMenu: vi.fn(),
  onRename: vi.fn(),
})

let host: HTMLElement

beforeEach(() => {
  document.body.innerHTML = '<div id="workspace"></div>'
  host = document.getElementById('workspace')!
})

function metaText(): string {
  return document.querySelector('.sidebar__meta')?.textContent ?? ''
}

describe('session sidebar pane count', () => {
  it('shows the file count for a session that is not running', () => {
    const sidebar = createSessionSidebar(host, hooks())
    sidebar.render([summary({ paneCount: 2 })], new Map(), null)
    expect(metaText()).toBe('2')
  })

  it('shows the live count for a running session, not the file count', () => {
    const sidebar = createSessionSidebar(host, hooks())
    // Split twice at runtime: the YAML still says 2.
    sidebar.render([summary({ paneCount: 2 })], new Map([['work', 4]]), null)
    expect(metaText()).toBe('4')
  })

  it('marks a session running when it has a live count', () => {
    const sidebar = createSessionSidebar(host, hooks())
    sidebar.render([summary()], new Map([['work', 2]]), null)
    expect(document.querySelectorAll('.sidebar__dot--on')).toHaveLength(1)
    expect(document.querySelectorAll('.sidebar__close')).toHaveLength(1)
  })

  it('keeps the error marker over any count', () => {
    const sidebar = createSessionSidebar(host, hooks())
    sidebar.render([summary({ error: 'YAML 문법 오류' })], new Map(), null)
    expect(metaText()).toBe('!')
  })
})

describe('inline rename', () => {
  function open(): { sidebar: ReturnType<typeof createSessionSidebar>; onRename: SidebarHooks['onRename'] } {
    const h = hooks()
    const sidebar = createSessionSidebar(host, h)
    sidebar.render([summary({ id: 'a', name: 'alpha' })], new Map(), null)
    sidebar.startRename('a')
    return { sidebar, onRename: h.onRename }
  }

  it('Enter commits a changed name', () => {
    const { onRename } = open()
    const input = host.querySelector<HTMLInputElement>('.sidebar__rename')!
    input.value = 'beta'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onRename).toHaveBeenCalledWith('a', 'beta')
  })

  it('Escape cancels and restores the name', () => {
    const { onRename } = open()
    const input = host.querySelector<HTMLInputElement>('.sidebar__rename')!
    input.value = 'beta'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onRename).not.toHaveBeenCalled()
    expect(host.querySelector('.sidebar__name')?.textContent).toBe('alpha')
  })

  it('the Enter that ends a composition does not commit', () => {
    const { onRename } = open()
    const input = host.querySelector<HTMLInputElement>('.sidebar__rename')!
    input.value = 'beta'
    const composing = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    Object.defineProperty(composing, 'isComposing', { value: true })
    input.dispatchEvent(composing)
    expect(onRename).not.toHaveBeenCalled()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onRename).toHaveBeenCalledWith('a', 'beta')
  })

  it('an empty or unchanged name is not committed', () => {
    const { onRename } = open()
    const input = host.querySelector<HTMLInputElement>('.sidebar__rename')!
    input.value = '   '
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onRename).not.toHaveBeenCalled()
  })
})
