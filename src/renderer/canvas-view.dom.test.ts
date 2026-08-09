import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCanvasView } from './canvas-view'
import { createLayout } from './layout-model'

const layout = createLayout([
  { id: 'c1', width: 700, panes: [{ id: 'a1', title: 'editor' }, { id: 'a2', title: 'shell' }] },
  { id: 'c2', width: 500, panes: [{ id: 'b1', title: 'server' }] },
])

let host: HTMLElement

beforeEach(() => {
  document.body.innerHTML = '<div id="canvas"></div>'
  host = document.getElementById('canvas')!
  // happy-dom computes no layout, so sizes are planted directly.
  Object.defineProperty(host, 'clientWidth', { value: 800, configurable: true })
  Object.defineProperty(host, 'clientHeight', { value: 600, configurable: true })
})

describe('createCanvasView', () => {
  it('creates one panel element per pane', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    expect(host.querySelectorAll('.pane')).toHaveLength(3)
  })

  it('marks only the focused pane', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render({ ...layout, focusedPaneId: 'b1' })
    const focused = host.querySelectorAll('.pane--focused')
    expect(focused).toHaveLength(1)
    expect(focused[0]!.getAttribute('data-pane-id')).toBe('b1')
  })

  it('reuses a pane element across renders, since xterm lives inside it', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    const before = host.querySelector('[data-pane-id="a1"]')
    view.render({ ...layout, focusedPaneId: 'a2' })
    expect(host.querySelector('[data-pane-id="a1"]')).toBe(before)
  })

  it('removes elements for panes that are gone', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    const smaller = createLayout([{ id: 'c1', panes: [{ id: 'a1', title: 'editor' }] }])
    view.render(smaller)
    expect(host.querySelectorAll('.pane')).toHaveLength(1)
  })

  it('positions panes in pixels', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    const first = host.querySelector<HTMLElement>('[data-pane-id="a1"]')!
    expect(first.style.left).toBe('6px')
    expect(first.style.width).toBe('700px')
  })

  it('calls the hook with the pane id on mousedown', () => {
    const onPaneMouseDown = vi.fn()
    const view = createCanvasView(host, { onPaneMouseDown })
    view.render(layout)
    host
      .querySelector('[data-pane-id="b1"]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onPaneMouseDown).toHaveBeenCalledWith('b1')
  })

  it('calls the click hook when the pointer barely moved', () => {
    const onPaneClick = vi.fn()
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn(), onPaneClick })
    view.render(layout)
    const pane = host.querySelector('[data-pane-id="b1"]')!
    pane.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 40 }))
    pane.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 102, clientY: 41 }))
    expect(onPaneClick).toHaveBeenCalledWith('b1')
  })

  it('stays quiet when the pointer was dragged, so selecting text does not scroll', () => {
    const onPaneClick = vi.fn()
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn(), onPaneClick })
    view.render(layout)
    const pane = host.querySelector('[data-pane-id="b1"]')!
    pane.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 40 }))
    pane.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 180, clientY: 44 }))
    expect(onPaneClick).not.toHaveBeenCalled()
  })

  it('stays quiet when the pointer was released over another pane', () => {
    const onPaneClick = vi.fn()
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn(), onPaneClick })
    view.render(layout)
    host
      .querySelector('[data-pane-id="a1"]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 40 }))
    host
      .querySelector('[data-pane-id="b1"]')!
      .dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 101, clientY: 40 }))
    expect(onPaneClick).not.toHaveBeenCalled()
  })

  it('getViewport reports host size and current scroll', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    expect(view.getViewport()).toEqual({ width: 800, height: 600, scrollX: 0 })
  })

  /*
   * xterm stops wheel propagation whenever mouse tracking is on or the buffer
   * has no scrollback (vim, less, htop). The canvas must have claimed the pan
   * before that happens, or a full-screen program freezes horizontal scrolling.
   */
  it('claims a horizontal wheel a pane swallows', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    const body = host.querySelector('[data-pane-id="a1"] .pane__body')!
    body.addEventListener('wheel', (event) => event.stopPropagation())

    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 120 })
    body.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves a vertical wheel over a pane to the terminal', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    const body = host.querySelector('[data-pane-id="a1"] .pane__body')!

    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 })
    body.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('one handle per column, one fewer than the panes', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    /*
     * Panes share a fixed column height, so the last one has nothing below to
     * take from — hence one fewer handle. Columns are absolute on an unbounded
     * canvas, so the last edge is a handle like any other.
     */
    expect(host.querySelectorAll('.resize-handle--column')).toHaveLength(2)
    expect(host.querySelectorAll('.resize-handle--pane')).toHaveLength(1)
  })

  it('a single column still gets a width handle', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(createLayout([{ id: 'c1', width: 700, panes: [{ id: 'p1', title: 'solo' }] }]))
    // Exactly the shape of a freshly created blank session.
    expect(host.querySelectorAll('.resize-handle--column')).toHaveLength(1)
    expect(host.querySelectorAll('.resize-handle--pane')).toHaveLength(0)
  })

  it('handles are wider than the visible gap', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    const handle = host.querySelector<HTMLElement>('.resize-handle--column')!
    // First column ends at 706, gap centre 709, so a 12px hitbox starts at 703
    expect(handle.style.left).toBe('703px')
    expect(handle.dataset['targetId']).toBe('c1')
  })
})
