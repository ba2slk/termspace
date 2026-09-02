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
  // A test that wants a fractional snap sets its own scale.
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
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

  /*
   * Zoom is view state: the pane's box changes, the layout behind it does not.
   * 800x600 host, 6px edges and a 10px floor, so the box is 788x584 at 6,6.
   */
  it('lays the zoomed pane over the visible canvas', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    view.setZoom('a1')
    const pane = host.querySelector<HTMLElement>('[data-pane-id="a1"]')!
    expect([pane.style.left, pane.style.top, pane.style.width, pane.style.height]).toEqual([
      '6px',
      '6px',
      '788px',
      '584px',
    ])
    expect(pane.classList.contains('pane--zoomed')).toBe(true)
  })

  /*
   * The track's transform snaps to device pixels; a wheel glide can stop the
   * scroll between them. Read raw, the zoom box would sit a fraction off the
   * screen and the pane behind it would show through at the edge.
   */
  it('places the zoom box at the scroll the transform actually used', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    view.scrollByExact(100.4) // within the 418px range this canvas has
    expect(view.root.style.transform).toBe('translateX(-100.5px)')
    view.setZoom('a1')
    const pane = host.querySelector<HTMLElement>('[data-pane-id="a1"]')!
    // 100.5 snapped + the 6px edge, rounded as every pane box is.
    expect(pane.style.left).toBe('107px')
  })

  it('covers the visible area behind the zoomed pane', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    view.scrollByExact(100.4)
    view.setZoom('a1')
    const scrim = host.querySelector<HTMLElement>('.zoom-scrim')!
    expect(scrim).not.toBeNull()
    expect([scrim.style.left, scrim.style.width, scrim.style.height]).toEqual([
      '100.5px',
      '800px',
      '600px',
    ])
    // Not a pane: the budget, the rects and every pane query must miss it.
    expect(scrim.classList.contains('pane')).toBe(false)
    expect(host.querySelectorAll('.pane')).toHaveLength(3)
    expect(view.getRects()).toHaveLength(3)
    expect(scrim.closest('.canvas-track')).not.toBeNull()
  })

  /*
   * The panes underneath need a layer of their own while a zoom is on, or their
   * peek labels (z-index 4 inside a pane that has none) draw over it.
   */
  it('marks the track while a pane is zoomed, and unmarks it after', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    expect(view.root.classList.contains('canvas-track--zoomed')).toBe(false)
    view.setZoom('a1')
    expect(view.root.classList.contains('canvas-track--zoomed')).toBe(true)
    view.setZoom(null)
    expect(view.root.classList.contains('canvas-track--zoomed')).toBe(false)
  })

  it('takes the scrim away with the zoom', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    view.setZoom('a1')
    view.setZoom(null)
    expect(host.querySelector('.zoom-scrim')).toBeNull()
  })

  it('leaves every other pane where the layout put it', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    const other = host.querySelector<HTMLElement>('[data-pane-id="b1"]')!
    const before = other.style.cssText
    view.setZoom('a1')
    expect(other.style.cssText).toBe(before)
    expect(other.classList.contains('pane--zoomed')).toBe(false)
  })

  it('restores the exact rect it had, in the element it already had', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    const pane = host.querySelector<HTMLElement>('[data-pane-id="a1"]')!
    const before = pane.style.cssText
    view.setZoom('a1')
    view.setZoom(null)
    // The same element throughout — xterm lives inside it.
    expect(host.querySelector('[data-pane-id="a1"]')).toBe(pane)
    expect(pane.style.cssText).toBe(before)
    expect(pane.classList.contains('pane--zoomed')).toBe(false)
  })

  it('ignores a pan while zoomed, so the pane cannot slide away', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    view.setZoom('a1')
    const before = view.root.style.transform
    view.panBy(240, 0)
    view.scrollByExact(240)
    expect(view.root.style.transform).toBe(before)
    expect(view.getViewport().scrollX).toBe(0)
  })

  it('scrolls again once the zoom is gone', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    view.setZoom('a1')
    view.setZoom(null)
    view.scrollByExact(120)
    expect(view.getViewport().scrollX).toBe(120)
  })

  /* The layout is untouched, so the budget still sees the panes as they are. */
  it('keeps getRects on the layout rects', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    const before = JSON.stringify(view.getRects())
    view.setZoom('a1')
    expect(JSON.stringify(view.getRects())).toBe(before)
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

  /*
   * The canvas claims the wheel in capture and stops propagation, so an open map
   * wide enough to pan never saw its own wheel events and would not move.
   */
  it('leaves the wheel to an open map that pans', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    const overlay = document.createElement('div')
    overlay.className = 'overview overview--pannable'
    host.append(overlay)

    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 })
    overlay.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('still takes the wheel under a map that fits', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    const overlay = document.createElement('div')
    overlay.className = 'overview'
    host.append(overlay)

    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 })
    overlay.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
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

  /*
   * The peek labels. CSS decides when they show; what the view owes is one per
   * named pane, with the pane's own title in it.
   */
  it('labels every pane that has a title of its own', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    const labels = [...host.querySelectorAll<HTMLElement>('.pane__label')]
    expect(labels).toHaveLength(3)
    expect(labels.filter((l) => !l.hidden).map((l) => l.textContent)).toEqual(['editor', 'server'])
  })

  it('leaves the default title unlabelled: it says nothing', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    const label = host.querySelector<HTMLElement>('[data-pane-id="a2"] .pane__label')!
    expect(label.hidden).toBe(true)
    expect(label.textContent).toBe('')
  })

  it('follows a rename', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    view.render(
      createLayout([
        { id: 'c1', width: 700, panes: [{ id: 'a1', title: 'notes' }, { id: 'a2', title: 'shell' }] },
      ]),
    )
    expect(host.querySelector('[data-pane-id="a1"] .pane__label')!.textContent).toBe('notes')
  })

  it('keeps the label inside the pane, so it changes no geometry', () => {
    const view = createCanvasView(host, { onPaneMouseDown: vi.fn() })
    view.render(layout)
    const pane = host.querySelector<HTMLElement>('[data-pane-id="a1"]')!
    expect(pane.querySelector('.pane__label')!.parentElement).toBe(pane)
    expect(pane.style.width).toBe('700px')
  })
})
