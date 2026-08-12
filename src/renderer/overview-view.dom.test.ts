import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLayout } from './layout-model'
import { overviewLayout } from './overview-model'
import { createOverviewView, type OverviewHooks } from './overview-view'
import { t } from './i18n'

const layout = createLayout([
  { id: 'c1', width: 700, panes: [{ id: 'a1', title: 'editor' }, { id: 'a2', title: 'shell' }] },
  { id: 'c2', width: 900, panes: [{ id: 'b1', title: 'server' }] },
])

let host: HTMLElement

const hooks = (over: Partial<OverviewHooks> = {}): OverviewHooks => ({
  layout: () => ({ ...layout, focusedPaneId: 'a1' }),
  viewport: () => ({ width: 800, height: 600, scrollX: 0 }),
  isError: () => false,
  commands: vi.fn(() => Promise.resolve({})),
  titles: vi.fn(() => Promise.resolve({})),
  wants: () => false,
  onJump: vi.fn(),
  onRename: vi.fn(),
  ...over,
})

/** The Enter that ends Korean composition. happy-dom ignores the init flag. */
const composingEnter = (): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
  Object.defineProperty(event, 'isComposing', { value: true })
  return event
}

const key = (code: string, mods: Partial<KeyboardEventInit> = {}): KeyboardEvent =>
  new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...mods })

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>'
  host = document.getElementById('host')!
})

describe('createOverviewView — opening', () => {
  it('draws one card per pane, titled', () => {
    const view = createOverviewView(host, hooks())
    view.open()
    expect(view.isOpen).toBe(true)
    expect(host.querySelectorAll('.overview__card')).toHaveLength(3)
    const titles = [...host.querySelectorAll('.overview__title')].map((el) => el.textContent)
    expect(titles).toEqual(['editor', 'shell', 'server'])
  })

  it('keeps the canvas proportions between cards', () => {
    const view = createOverviewView(host, hooks())
    view.open()
    const widths = [...host.querySelectorAll<HTMLElement>('.overview__card')].map((el) =>
      Number.parseFloat(el.style.width),
    )
    expect(widths[2]! / widths[0]!).toBeCloseTo(900 / 700, 2)
  })

  it('starts with the focused pane selected, and shows the viewport marker', () => {
    const view = createOverviewView(host, hooks())
    view.open()
    const selected = host.querySelector<HTMLElement>('.overview__card--selected')
    expect(selected?.dataset['paneId']).toBe('a1')
    expect(host.querySelector('.overview__viewport')).not.toBeNull()
  })

  it('marks error panes', () => {
    const view = createOverviewView(host, hooks({ isError: (id) => id === 'a2' }))
    view.open()
    const error = host.querySelector<HTMLElement>('.overview__card--error')
    expect(error?.dataset['paneId']).toBe('a2')
  })

  it('fills in running commands once they arrive', async () => {
    const view = createOverviewView(
      host,
      hooks({ commands: () => Promise.resolve({ a1: 'nvim .', a2: null, b1: null }) }),
    )
    view.open()
    await Promise.resolve()
    const card = host.querySelector<HTMLElement>('[data-pane-id="a1"]')
    expect(card?.querySelector('.overview__command')?.textContent).toBe('nvim .')
    expect(card?.classList.contains('overview__card--running')).toBe(true)
  })
})

describe('createOverviewView — keys', () => {
  it('arrows move the selection as canvas focus would', () => {
    const view = createOverviewView(host, hooks())
    view.open()
    expect(view.handleKey(key('ArrowDown'))).toBe(true)
    expect(host.querySelector<HTMLElement>('.overview__card--selected')?.dataset['paneId']).toBe(
      'a2',
    )
    expect(view.handleKey(key('ArrowRight'))).toBe(true)
    expect(host.querySelector<HTMLElement>('.overview__card--selected')?.dataset['paneId']).toBe(
      'b1',
    )
  })

  it('Enter jumps to the selection and closes', () => {
    const jumped: string[] = []
    const view = createOverviewView(host, hooks({ onJump: (id) => jumped.push(id) }))
    view.open()
    view.handleKey(key('ArrowRight'))
    view.handleKey(key('Enter', { key: 'Enter' }))
    expect(jumped).toEqual(['b1'])
    expect(view.isOpen).toBe(false)
  })

  it('Escape closes without jumping', () => {
    const onJump = vi.fn()
    const view = createOverviewView(host, hooks({ onJump }))
    view.open()
    view.handleKey(key('Escape', { key: 'Escape' }))
    expect(view.isOpen).toBe(false)
    expect(onJump).not.toHaveBeenCalled()
  })

  it('owns every key while open', () => {
    const view = createOverviewView(host, hooks())
    view.open()
    expect(view.handleKey(key('KeyX'))).toBe(true)
  })
})

describe('card title editing', () => {
  function editing(): { view: ReturnType<typeof createOverviewView>; onRename: OverviewHooks['onRename'] } {
    const onRename = vi.fn()
    const view = createOverviewView(host, hooks({ onRename }))
    view.open()
    view.handleKey(new KeyboardEvent('keydown', { key: 'F2' }))
    return { view, onRename }
  }

  it('F2 opens an editor on the selected card; Enter commits', () => {
    const { onRename } = editing()
    const input = host.querySelector<HTMLInputElement>('.overview__rename')!
    input.value = 'build'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onRename).toHaveBeenCalledWith('a1', 'build')
    expect(host.querySelector('.overview__card--selected .overview__title')?.textContent).toBe(
      'build',
    )
  })

  it('Escape cancels without renaming', () => {
    const { onRename } = editing()
    const input = host.querySelector<HTMLInputElement>('.overview__rename')!
    input.value = 'nope'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onRename).not.toHaveBeenCalled()
  })

  it('reports isEditing across the edit lifecycle', () => {
    const view = createOverviewView(host, hooks())
    view.open()
    expect(view.isEditing).toBe(false)
    view.handleKey(new KeyboardEvent('keydown', { key: 'F2' }))
    expect(view.isEditing).toBe(true)
    host
      .querySelector<HTMLInputElement>('.overview__rename')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(view.isEditing).toBe(false)
  })

  it('leaves plain typing to the input', () => {
    editing()
    const input = host.querySelector<HTMLInputElement>('.overview__rename')!
    const typed = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    input.dispatchEvent(typed)
    expect(typed.defaultPrevented).toBe(false)
  })

  it('the Enter that ends a composition does not commit', () => {
    const { onRename } = editing()
    const input = host.querySelector<HTMLInputElement>('.overview__rename')!
    input.value = 'build'
    input.dispatchEvent(composingEnter())
    expect(onRename).not.toHaveBeenCalled()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onRename).toHaveBeenCalledWith('a1', 'build')
  })

  /*
   * The caller saves the session file on every onRename, so a commit that
   * changed nothing must not reach the hook at all.
   */
  it('an empty or unchanged title is not committed', () => {
    for (const value of ['   ', 'editor']) {
      const { onRename } = editing()
      const input = host.querySelector<HTMLInputElement>('.overview__rename')!
      input.value = value
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      expect(onRename).not.toHaveBeenCalled()
    }
  })

  /*
   * A ringing pane elsewhere repaints the map. That must not pull the input
   * out from under the typing: removing it fires no blur, so the view would be
   * left believing an editor it no longer has is still open.
   */
  it('survives a repaint while the title is being typed', () => {
    const { view, onRename } = editing()
    const input = host.querySelector<HTMLInputElement>('.overview__rename')!
    input.value = 'build'
    view.refreshIfOpen()
    expect(view.isEditing).toBe(true)
    expect(host.querySelector('.overview__rename')).toBe(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onRename).toHaveBeenCalledWith('a1', 'build')
    expect(view.isEditing).toBe(false)
  })

  it('navigation keys are inert while editing', () => {
    const { view } = editing()
    const before = host.querySelector('.overview__card--selected')?.getAttribute('data-pane-id')
    expect(view.handleKey(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight' }))).toBe(
      true,
    )
    expect(host.querySelector('.overview__card--selected')?.getAttribute('data-pane-id')).toBe(
      before,
    )
  })
})

describe('createOverviewView — key legend', () => {
  const legend = (): string => host.querySelector('.overview__legend')?.textContent ?? ''

  const joined = (hints: readonly { key: string; label: string }[]): string =>
    hints.map((h) => `${h.key} ${h.label}`).join(' · ')

  it('names the keys the map answers to, F2 among them', () => {
    const view = createOverviewView(host, hooks())
    view.open()
    expect(t.overview.mapKeys[2]!.key).toBe('F2')
    expect(legend()).toBe(joined(t.overview.mapKeys))
  })

  it('swaps to the editor keys while a title is being typed, and back', () => {
    const view = createOverviewView(host, hooks())
    view.open()
    view.handleKey(new KeyboardEvent('keydown', { key: 'F2' }))
    expect(legend()).toBe(joined(t.overview.editKeys))

    host
      .querySelector<HTMLInputElement>('.overview__rename')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(legend()).toContain(t.overview.mapKeys[0]!.label)
  })
})

describe('createOverviewView — mouse', () => {
  it('clicking a card jumps there', () => {
    const jumped: string[] = []
    const view = createOverviewView(host, hooks({ onJump: (id) => jumped.push(id) }))
    view.open()
    host
      .querySelector<HTMLElement>('[data-pane-id="b1"]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(jumped).toEqual(['b1'])
    expect(view.isOpen).toBe(false)
  })

  it('clicking outside the map closes without jumping', () => {
    const onJump = vi.fn()
    const view = createOverviewView(host, hooks({ onJump }))
    view.open()
    host
      .querySelector<HTMLElement>('.overview')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(view.isOpen).toBe(false)
    expect(onJump).not.toHaveBeenCalled()
  })
})

describe('createOverviewView — viewport tracking', () => {
  it('syncViewport moves the marker to where the canvas scrolled', () => {
    let scrollX = 0
    const view = createOverviewView(
      host,
      hooks({ viewport: () => ({ width: 800, height: 600, scrollX }) }),
    )
    view.open()
    const marker = host.querySelector<HTMLElement>('.overview__viewport')!
    expect(Number.parseFloat(marker.style.left)).toBe(0)

    scrollX = 200
    view.syncViewport()
    const expected = overviewLayout(
      { ...layout, focusedPaneId: 'a1' },
      { width: 800, height: 600, scrollX },
    ).viewportRect.x
    expect(expected).toBeGreaterThan(0)
    expect(Number.parseFloat(marker.style.left)).toBeCloseTo(expected, 3)
  })

  it('syncViewport while closed is a no-op', () => {
    const view = createOverviewView(host, hooks())
    expect(() => view.syncViewport()).not.toThrow()
    expect(host.querySelector('.overview')).toBeNull()
  })
})

describe('createOverviewView — pannable map', () => {
  // Twelve wide columns: the scale floor makes the map wider than this viewport.
  const wide = createLayout(
    Array.from({ length: 12 }, (_, i) => ({
      id: `c${String(i)}`,
      width: 640,
      panes: [{ id: `p${String(i)}`, title: `pane ${String(i)}` }],
    })),
  )
  const wideHooks = (focused = 'p6'): OverviewHooks =>
    hooks({ layout: () => ({ ...wide, focusedPaneId: focused }) })

  it('marks the map pannable and starts revealing the focused card', () => {
    const view = createOverviewView(host, wideHooks())
    view.open()
    expect(host.querySelector('.overview--pannable')).not.toBeNull()
    const map = host.querySelector<HTMLElement>('.overview__map')!
    expect(map.style.transform).toMatch(/translateX\(-?\d/)
  })

  it('wheel pans and clamps at the ends', () => {
    const view = createOverviewView(host, wideHooks())
    view.open()
    const overview = host.querySelector<HTMLElement>('.overview')!
    overview.dispatchEvent(new WheelEvent('wheel', { deltaY: -9999, cancelable: true }))
    const map = host.querySelector<HTMLElement>('.overview__map')!
    expect(map.style.transform).toBe('translateX(0px)')
  })

  it('arrow selection keeps the selected card in view', () => {
    const view = createOverviewView(host, wideHooks('p0'))
    view.open()
    // Walk right to the far column; the transform must have moved left (negative).
    for (let i = 0; i < 20; i++) view.handleKey(key('ArrowRight'))
    const map = host.querySelector<HTMLElement>('.overview__map')!
    const offset = Number(/translateX\((-?[\d.]+)px\)/.exec(map.style.transform)?.[1])
    expect(offset).toBeLessThan(0)
  })

  it('a small session is centred and untransformed, as today', () => {
    const view = createOverviewView(
      host,
      hooks({ viewport: () => ({ width: 1600, height: 900, scrollX: 0 }) }),
    )
    view.open()
    expect(host.querySelector('.overview--pannable')).toBeNull()
    const map = host.querySelector<HTMLElement>('.overview__map')!
    expect(map.style.transform).toBe('translateX(0px)')
  })

  it('a map that fits lets the wheel through to the canvas underneath', () => {
    const view = createOverviewView(
      host,
      hooks({ viewport: () => ({ width: 1600, height: 900, scrollX: 0 }) }),
    )
    view.open()
    const overview = host.querySelector<HTMLElement>('.overview')!
    const event = new WheelEvent('wheel', { deltaY: 400, cancelable: true })
    overview.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    const map = host.querySelector<HTMLElement>('.overview__map')!
    expect(map.style.transform).toBe('translateX(0px)')
  })

  it('a pannable map takes the wheel for itself', () => {
    const view = createOverviewView(host, wideHooks())
    view.open()
    const overview = host.querySelector<HTMLElement>('.overview')!
    const event = new WheelEvent('wheel', { deltaY: 400, cancelable: true })
    overview.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('createOverviewView — lifecycle', () => {
  it('toggle opens and closes', () => {
    const view = createOverviewView(host, hooks())
    view.toggle()
    expect(view.isOpen).toBe(true)
    view.toggle()
    expect(view.isOpen).toBe(false)
    expect(host.querySelector('.overview')).toBeNull()
  })

  it('reopening re-reads the layout snapshot', () => {
    let focused = 'a1'
    const view = createOverviewView(
      host,
      hooks({ layout: () => ({ ...layout, focusedPaneId: focused }) }),
    )
    view.open()
    view.close()
    focused = 'b1'
    view.open()
    expect(host.querySelector<HTMLElement>('.overview__card--selected')?.dataset['paneId']).toBe(
      'b1',
    )
  })
})
