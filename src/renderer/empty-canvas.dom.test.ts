import { describe, expect, it, vi } from 'vitest'

// The module reads the platform from the bridge as it loads, to format chords.
vi.stubGlobal('termspace', { platform: 'linux' })

const { createEmptyCanvas } = await import('./empty-canvas')

const create = (onCreateSession = vi.fn()) => ({
  view: createEmptyCanvas({ onCreateSession }),
  onCreateSession,
})

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
})
