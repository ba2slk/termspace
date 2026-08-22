import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSummary } from '../shared/protocol'
import type { SidebarHooks } from './session-sidebar'

/*
 * The sidebar reads the platform from the bridge as the module loads — Ctrl is
 * a plain modifier here and the right click on mac — so the stub has to be on
 * window before the import. The mac half lives in its own file.
 */
vi.stubGlobal('termspace', { platform: 'linux' })

const { createSessionSidebar } = await import('./session-sidebar')

function summary(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'work',
    name: 'work',
    file: '/s/work.yaml',
    paneCount: 2,
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
  gotoHint: (index: number) => `Alt+${String(index + 1)}`,
  onCreateBlank: vi.fn(),
  onContextMenu: vi.fn(),
  onRename: vi.fn(),
  onReorder: vi.fn(),
  onArchive: vi.fn(),
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

describe('the archive dock', () => {
  const open = (): { h: SidebarHooks; sidebar: ReturnType<typeof createSessionSidebar> } => {
    const h = hooks()
    return { h, sidebar: createSessionSidebar(host, h) }
  }

  const header = (): HTMLElement | null => host.querySelector('.sidebar__dock-header')

  // happy-dom's TransitionEvent drops propertyName, which is what is read here.
  const transitionEnd = (propertyName: string): Event =>
    Object.assign(new Event('transitionend'), { propertyName })

  it('is not there at all while nothing is archived', () => {
    const { sidebar } = open()
    sidebar.render([summary()], new Map(), null)
    expect(host.querySelector('.sidebar__dock')).toBeNull()
  })

  it('appears with the archived count once something is archived', () => {
    const { sidebar } = open()
    sidebar.render(
      [summary(), summary({ id: 'old', archived: true }), summary({ id: 'older', archived: true })],
      new Map(),
      null,
    )
    expect(host.querySelector('.sidebar__dock-count')?.textContent).toBe('2')
  })

  it('starts closed and the header toggles it', () => {
    const { sidebar } = open()
    sidebar.render([summary(), summary({ id: 'old', archived: true })], new Map(), null)
    const dock = host.querySelector<HTMLElement>('.sidebar__dock')!
    expect(dock.classList.contains('sidebar__dock--open')).toBe(false)
    header()!.click()
    expect(dock.classList.contains('sidebar__dock--open')).toBe(true)
    header()!.click()
    expect(dock.classList.contains('sidebar__dock--open')).toBe(false)
  })

  it('scrolls only once the opening height has arrived, and never while closed', () => {
    const { sidebar } = open()
    sidebar.render([summary(), summary({ id: 'old', archived: true })], new Map(), null)
    const dock = host.querySelector<HTMLElement>('.sidebar__dock')!
    const dockList = host.querySelector<HTMLElement>('.sidebar__dock-list')!
    header()!.click()
    expect(dock.classList.contains('sidebar__dock--settled')).toBe(false)
    // Another property finishing first is not the height arriving.
    dockList.dispatchEvent(transitionEnd('opacity'))
    expect(dock.classList.contains('sidebar__dock--settled')).toBe(false)
    dockList.dispatchEvent(transitionEnd('max-height'))
    expect(dock.classList.contains('sidebar__dock--settled')).toBe(true)
    header()!.click()
    expect(dock.classList.contains('sidebar__dock--settled')).toBe(false)
    // The closing transition ends too, and must not hand scrolling back.
    dockList.dispatchEvent(transitionEnd('max-height'))
    expect(dock.classList.contains('sidebar__dock--settled')).toBe(false)
  })

  it('archived rows stay out of the list the dial and the drag walk', () => {
    const { sidebar } = open()
    sidebar.render([summary(), summary({ id: 'old', archived: true })], new Map(), null)
    expect(host.querySelectorAll('.sidebar__list .sidebar__row')).toHaveLength(1)
    expect(host.querySelectorAll('.sidebar__dock-list .sidebar__row')).toHaveLength(1)
  })

  it('an archived row is a name and nothing else, and does not open', () => {
    const { h, sidebar } = open()
    sidebar.render([summary({ id: 'old', name: 'old', archived: true })], new Map([['old', 1]]), null)
    const row = host.querySelector<HTMLElement>('.sidebar__row--archived')!
    expect(row.querySelector('.sidebar__name')?.textContent).toBe('old')
    expect(row.querySelector('.sidebar__dot')).toBeNull()
    expect(row.querySelector('.sidebar__meta')).toBeNull()
    expect(row.querySelector('.sidebar__hint')).toBeNull()
    expect(row.querySelector('.sidebar__close')).toBeNull()
    row.click()
    expect(h.onOpen).not.toHaveBeenCalled()
  })

  it('a right click on an archived row says so, so the shell can offer Restore', () => {
    const { h, sidebar } = open()
    sidebar.render([summary({ id: 'a' }), summary({ id: 'old', archived: true })], new Map(), null)
    host
      .querySelector('.sidebar__row--archived')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(h.onContextMenu).toHaveBeenLastCalledWith(expect.anything(), 'old', true)
    host
      .querySelector('.sidebar__list .sidebar__row')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(h.onContextMenu).toHaveBeenLastCalledWith(expect.anything(), 'a', false)
  })
})

describe('reordering by drag', () => {
  function renderThreeSessions(
    over: { live?: ReadonlyMap<string, number>; broken?: string; archived?: boolean } = {},
  ): {
    hooks: SidebarHooks
    sidebar: ReturnType<typeof createSessionSidebar>
    rows: HTMLElement[]
  } {
    const h = hooks()
    const sidebar = createSessionSidebar(host, h)
    const live = ['a', 'b', 'c'].map((id) =>
      summary({
        id,
        name: id,
        file: `/s/${id}.yaml`,
        paneCount: 1,
        createdMs: 1,
        error: id === over.broken ? 'bad file' : null,
      }),
    )
    // One archived session puts the dock on screen without a drag.
    const all = over.archived === true ? [...live, summary({ id: 'old', archived: true })] : live
    sidebar.render(all, over.live ?? new Map(), null)
    return {
      hooks: h,
      sidebar,
      rows: [...host.querySelectorAll<HTMLElement>('.sidebar__list .sidebar__row')],
    }
  }

  // happy-dom gives every element a zero-size box, so rows need one to drop onto.
  const stubBoxes = (rows: readonly HTMLElement[]): void => {
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () =>
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

  const press = (el: HTMLElement, y: number, type: string): void => {
    el.dispatchEvent(
      new PointerEvent(type, { clientX: 20, clientY: y, bubbles: true, cancelable: true, pointerId: 1 }),
    )
  }

  it('a press that barely moves still opens the session and reorders nothing', () => {
    const { hooks: h, rows } = renderThreeSessions()
    stubBoxes(rows)
    press(rows[0]!, 110, 'pointerdown')
    press(rows[0]!, 113, 'pointermove')
    press(rows[0]!, 113, 'pointerup')
    rows[0]!.querySelector<HTMLButtonElement>('.sidebar__open')!.click()
    expect(h.onReorder).not.toHaveBeenCalled()
    expect(h.onOpen).toHaveBeenCalledWith('a')
  })

  it('a drag past the threshold reorders and does not open', () => {
    const { hooks: h, rows } = renderThreeSessions()
    stubBoxes(rows)
    press(rows[0]!, 110, 'pointerdown')
    press(rows[0]!, 210, 'pointermove')
    press(rows[0]!, 210, 'pointerup')
    rows[0]!.querySelector<HTMLButtonElement>('.sidebar__open')!.click()
    expect(h.onReorder).toHaveBeenCalledWith('a', 2)
    expect(h.onOpen).not.toHaveBeenCalled()
  })

  it('Escape mid-drag cancels: nothing opens, nothing moves', () => {
    const { hooks: h, rows } = renderThreeSessions()
    stubBoxes(rows)
    press(rows[0]!, 110, 'pointerdown')
    press(rows[0]!, 210, 'pointermove')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    press(rows[0]!, 210, 'pointerup')
    rows[0]!.querySelector<HTMLButtonElement>('.sidebar__open')!.click()
    expect(h.onReorder).not.toHaveBeenCalled()
    expect(h.onOpen).not.toHaveBeenCalled()
  })

  it('the Escape that cancels a drag is not visible to the rest of the app', () => {
    const { hooks: h, rows } = renderThreeSessions()
    stubBoxes(rows)
    // A stand-in for the menus and views that listen on window in capture too.
    const other = vi.fn()
    window.addEventListener('keydown', other, true)
    const escape = (): void => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }
    try {
      // No drag under it: this Escape belongs to whoever else wants it.
      escape()
      expect(other).toHaveBeenCalledTimes(1)

      press(rows[0]!, 110, 'pointerdown')
      press(rows[0]!, 210, 'pointermove')
      escape()
      expect(other).toHaveBeenCalledTimes(1)
      expect(h.onReorder).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', other, true)
    }
  })

  it('a press on the power button never becomes a drag, and still ends the session', () => {
    const { hooks: h, rows } = renderThreeSessions({ live: new Map([['a', 1]]) })
    stubBoxes(rows)
    const power = rows[0]!.querySelector<HTMLButtonElement>('.sidebar__close')!
    press(power, 110, 'pointerdown')
    press(power, 210, 'pointermove')
    press(power, 210, 'pointerup')
    power.click()
    expect(h.onReorder).not.toHaveBeenCalled()
    expect(h.onClose).toHaveBeenCalledWith('a')
  })

  it('a session with a bad file can still be dragged', () => {
    const { hooks: h, rows } = renderThreeSessions({ broken: 'a' })
    stubBoxes(rows)
    const name = rows[0]!.querySelector<HTMLElement>('.sidebar__name')!
    press(name, 110, 'pointerdown')
    press(name, 210, 'pointermove')
    press(name, 210, 'pointerup')
    expect(h.onReorder).toHaveBeenCalledWith('a', 2)
  })

  it('a cancelled drag does not eat the next press', () => {
    const { hooks: h, rows } = renderThreeSessions({ live: new Map([['b', 1]]) })
    stubBoxes(rows)
    press(rows[0]!, 110, 'pointerdown')
    press(rows[0]!, 210, 'pointermove')
    press(rows[0]!, 210, 'pointercancel')
    // A fresh press on another row: the swallow armed by the cancel is stale.
    const power = rows[1]!.querySelector<HTMLButtonElement>('.sidebar__close')!
    press(power, 150, 'pointerdown')
    press(power, 150, 'pointerup')
    power.click()
    expect(h.onClose).toHaveBeenCalledWith('b')
  })

  it('a re-render mid-drag cancels it: the release reorders nothing', () => {
    const { hooks: h, sidebar, rows } = renderThreeSessions()
    stubBoxes(rows)
    press(rows[0]!, 110, 'pointerdown')
    press(rows[0]!, 210, 'pointermove')
    // A background pty ringing rebuilds every row under the pointer.
    sidebar.render(
      ['a', 'b', 'c'].map((id) => summary({ id, name: id, paneCount: 1, createdMs: 1 })),
      new Map(),
      null,
      new Set(['c']),
    )
    press(rows[0]!, 210, 'pointerup')
    expect(h.onReorder).not.toHaveBeenCalled()
    expect(rows[0]!.classList.contains('sidebar__row--dragging')).toBe(false)
    expect(rows[0]!.style.transform).toBe('')
  })

  it('the wheel dial works again after a press that never released', () => {
    const { rows } = renderThreeSessions()
    stubBoxes(rows)
    press(rows[0]!, 110, 'pointerdown')
    const list = host.querySelector<HTMLElement>('.sidebar__list')!
    // The pointer leaves the sidebar before it ever moved: no pointerup arrives.
    list.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1 }))
    for (let i = 0; i < 10; i++) {
      list.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
    }
    expect(host.querySelectorAll('.sidebar__row--preview')).toHaveLength(1)
  })

  // happy-dom gives no boxes, so the dock header needs one to be aimed at.
  const stubHeader = (top: number): void => {
    const head = host.querySelector<HTMLElement>('.sidebar__dock-header')!
    head.getBoundingClientRect = () =>
      ({
        top,
        height: 30,
        bottom: top + 30,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect
  }

  it('a drag over the archive header aims at it, and dropping archives', () => {
    const { hooks: h, rows } = renderThreeSessions({ archived: true })
    stubBoxes(rows)
    stubHeader(300)
    press(rows[0]!, 110, 'pointerdown')
    press(rows[0]!, 320, 'pointermove')
    const head = host.querySelector<HTMLElement>('.sidebar__dock-header')!
    expect(head.classList.contains('sidebar__dock-header--target')).toBe(true)
    press(rows[0]!, 320, 'pointerup')
    expect(h.onArchive).toHaveBeenCalledWith('a')
    expect(h.onReorder).not.toHaveBeenCalled()
    expect(head.classList.contains('sidebar__dock-header--target')).toBe(false)
  })

  it('a drag that leaves the header again drops back into the list', () => {
    const { hooks: h, rows } = renderThreeSessions({ archived: true })
    stubBoxes(rows)
    stubHeader(300)
    press(rows[0]!, 110, 'pointerdown')
    press(rows[0]!, 320, 'pointermove')
    press(rows[0]!, 210, 'pointermove')
    const head = host.querySelector<HTMLElement>('.sidebar__dock-header')!
    expect(head.classList.contains('sidebar__dock-header--target')).toBe(false)
    press(rows[0]!, 210, 'pointerup')
    expect(h.onReorder).toHaveBeenCalledWith('a', 2)
    expect(h.onArchive).not.toHaveBeenCalled()
  })

  it('Escape over the header archives nothing and clears the highlight', () => {
    const { hooks: h, rows } = renderThreeSessions({ archived: true })
    stubBoxes(rows)
    stubHeader(300)
    press(rows[0]!, 110, 'pointerdown')
    press(rows[0]!, 320, 'pointermove')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    press(rows[0]!, 320, 'pointerup')
    expect(h.onArchive).not.toHaveBeenCalled()
    const head = host.querySelector<HTMLElement>('.sidebar__dock-header')!
    expect(head.classList.contains('sidebar__dock-header--target')).toBe(false)
  })

  it('with nothing archived yet the header appears for the drag, and leaves with it', () => {
    const { rows } = renderThreeSessions()
    stubBoxes(rows)
    expect(host.querySelector('.sidebar__dock')).toBeNull()
    press(rows[0]!, 110, 'pointerdown')
    press(rows[0]!, 210, 'pointermove')
    expect(host.querySelector('.sidebar__dock-header')).not.toBeNull()
    press(rows[0]!, 210, 'pointercancel')
    expect(host.querySelector('.sidebar__dock')).toBeNull()
  })

  it('a dock emptied by a restore lends nothing of the old archive to the next drag', () => {
    const { sidebar } = renderThreeSessions({ archived: true })
    host.querySelector<HTMLElement>('.sidebar__dock-header')!.click()
    // Everything restored: the dock leaves the screen and must go empty with it.
    sidebar.render(
      ['a', 'b', 'c'].map((id) => summary({ id, name: id, paneCount: 1, createdMs: 1 })),
      new Map(),
      null,
    )
    const rows = [...host.querySelectorAll<HTMLElement>('.sidebar__list .sidebar__row')]
    stubBoxes(rows)
    press(rows[0]!, 110, 'pointerdown')
    press(rows[0]!, 210, 'pointermove')
    const dock = host.querySelector<HTMLElement>('.sidebar__dock')!
    expect(dock.querySelectorAll('.sidebar__row')).toHaveLength(0)
    expect(dock.querySelector('.sidebar__dock-count')?.textContent).toBe('')
    expect(dock.classList.contains('sidebar__dock--open')).toBe(false)
  })

  it('the temporary header also leaves after a plain drop', () => {
    const { rows } = renderThreeSessions()
    stubBoxes(rows)
    press(rows[0]!, 110, 'pointerdown')
    press(rows[0]!, 210, 'pointermove')
    press(rows[0]!, 210, 'pointerup')
    expect(host.querySelector('.sidebar__dock')).toBeNull()
  })

  it('the wheel dial does not run while a drag is live', () => {
    const { hooks: h, rows } = renderThreeSessions()
    stubBoxes(rows)
    press(rows[0]!, 110, 'pointerdown')
    press(rows[0]!, 210, 'pointermove')
    const list = host.querySelector<HTMLElement>('.sidebar__list')!
    for (let i = 0; i < 10; i++) {
      list.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
    }
    expect(host.querySelectorAll('.sidebar__row--preview')).toHaveLength(0)
  })
})
