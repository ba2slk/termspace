/*
 * The sidebar on mac. Its own file because the platform is read once as the
 * module loads, so one process can only ever see one platform.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSummary } from '../shared/protocol'
import type { SidebarHooks } from './session-sidebar'

vi.stubGlobal('termspace', { platform: 'darwin' })

const { createSessionSidebar } = await import('./session-sidebar')

function summary(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'work',
    name: 'work',
    file: '/s/work.yaml',
    paneCount: 1,
    createdMs: 0,
    error: null,
    archived: false,
    ...over,
  }
}

const hooks = (): SidebarHooks => ({
  onOpen: vi.fn(),
  onClose: vi.fn(),
  onRefresh: vi.fn(),
  onWidthChange: vi.fn(),
  onArchive: vi.fn(),
  gotoHint: (index: number) => `Cmd+${String(index + 1)}`,
  onCreateBlank: vi.fn(),
  onContextMenu: vi.fn(),
  onRename: vi.fn(),
  onReorder: vi.fn(),
})

let host: HTMLElement

beforeEach(() => {
  document.body.innerHTML = '<div id="workspace"></div>'
  host = document.getElementById('workspace')!
})

function pointer(el: HTMLElement, type: string, y: number, over: PointerEventInit = {}): void {
  el.dispatchEvent(
    new PointerEvent(type, {
      clientX: 20,
      clientY: y,
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      button: 0,
      ...over,
    }),
  )
}

function stubBoxes(rows: readonly HTMLElement[]): void {
  rows.forEach((row, i) => {
    row.getBoundingClientRect = (): DOMRect =>
      ({
        top: 100 + i * 40,
        height: 40,
        bottom: 140 + i * 40,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: 100 + i * 40,
        toJSON: () => ({}),
      }) as DOMRect
  })
}

describe('Ctrl+click on mac', () => {
  it('opens the context menu without arming a drag', () => {
    const h = hooks()
    const sidebar = createSessionSidebar(host, h)
    sidebar.render(
      [summary({ id: 'a', name: 'a' }), summary({ id: 'b', name: 'b' })],
      new Map(),
      null,
    )
    const rows = [...document.querySelectorAll<HTMLElement>('.sidebar__row')]
    stubBoxes(rows)

    // Ctrl+click is the mac right click, and it arrives as button 0.
    pointer(rows[0]!, 'pointerdown', 110, { ctrlKey: true })
    pointer(rows[0]!, 'pointermove', 190, { ctrlKey: true })
    pointer(rows[0]!, 'pointerup', 190, { ctrlKey: true })

    expect(h.onReorder).not.toHaveBeenCalled()
    expect(rows[0]!.className).not.toContain('sidebar__row--dragging')
  })

  it('still drags on a plain press', () => {
    const h = hooks()
    const sidebar = createSessionSidebar(host, h)
    sidebar.render(
      [summary({ id: 'a', name: 'a' }), summary({ id: 'b', name: 'b' })],
      new Map(),
      null,
    )
    const rows = [...document.querySelectorAll<HTMLElement>('.sidebar__row')]
    stubBoxes(rows)

    pointer(rows[0]!, 'pointerdown', 110)
    pointer(rows[0]!, 'pointermove', 190)
    pointer(rows[0]!, 'pointerup', 190)

    expect(h.onReorder).toHaveBeenCalledWith('a', 1)
  })
})
