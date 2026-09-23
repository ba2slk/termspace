import { describe, expect, it, vi } from 'vitest'

// The module reads the platform from the bridge as it loads, to format chords.
vi.stubGlobal('termspace', { platform: 'linux' })

const { createEmptyCanvas } = await import('./empty-canvas')

const create = (onCreateSession = vi.fn(), onOpenTerminal = vi.fn()) => ({
  view: createEmptyCanvas({ onCreateSession, onOpenTerminal }),
  onCreateSession,
  onOpenTerminal,
})

const terminalButton = (el: HTMLElement): HTMLButtonElement =>
  el.querySelector<HTMLButtonElement>('.canvas-empty__terminal')!

const button = (el: HTMLElement): HTMLButtonElement =>
  el.querySelector<HTMLButtonElement>('.canvas-empty__create')!

describe('createEmptyCanvas', () => {
  it('offers to create a session only while the list is empty', () => {
    const { view } = create()
    view.setHasSessions(true)
    expect(button(view.el).hidden).toBe(true)
    view.setHasSessions(false)
    expect(button(view.el).hidden).toBe(false)
  })

  it('calls the hook when the button is pressed', () => {
    const { view, onCreateSession } = create()
    view.setHasSessions(false)
    button(view.el).click()
    expect(onCreateSession).toHaveBeenCalledTimes(1)
  })

  it('always offers a new terminal, above the new session', () => {
    const { view } = create()
    view.setHasSessions(false)
    const terminal = terminalButton(view.el)
    expect(terminal.hidden).toBe(false)
    expect(terminal.textContent).toBe('New terminal')
    expect(terminal.compareDocumentPosition(button(view.el)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    view.setHasSessions(true)
    expect(terminal.hidden).toBe(false)
  })

  it('opens a terminal when pressed', () => {
    const { view, onOpenTerminal } = create()
    terminalButton(view.el).click()
    expect(onOpenTerminal).toHaveBeenCalledTimes(1)
  })

  // No terminal wants keys while the canvas is empty, so Enter can have them.
  it('takes focus when it appears', () => {
    const { view } = create()
    document.body.append(view.el)
    view.setHidden(true)
    view.setHidden(false)
    expect(document.activeElement).toBe(terminalButton(view.el))
    view.el.remove()
  })
})
