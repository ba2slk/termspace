import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLayout } from './layout-model'
import { overviewLayout } from './overview-model'
import { createOverviewView, type OverviewHooks } from './overview-view'

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
  ...over,
})

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
