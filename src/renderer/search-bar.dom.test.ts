import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSearchBar, type SearchTarget } from './search-bar'

let host: HTMLElement

function target() {
  const t = {
    findNext: vi.fn<(query: string, caseSensitive: boolean, incremental?: boolean) => void>(),
    findPrevious: vi.fn<(query: string, caseSensitive: boolean) => void>(),
    clearSearch: vi.fn<() => void>(),
    onSearchResults: vi.fn((_listener: (i: number, c: number) => void) => () => {}),
    focus: vi.fn<() => void>(),
  }
  return t satisfies SearchTarget
}

const input = (): HTMLInputElement => host.querySelector('.search-bar__input')!

const key = (name: string, mods: Partial<KeyboardEventInit> = {}): void => {
  input().dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...mods }),
  )
}

beforeEach(() => {
  document.body.innerHTML = '<div id="body"></div>'
  host = document.getElementById('body')!
})

describe('createSearchBar', () => {
  it('Enter finds the next match', () => {
    const bar = createSearchBar()
    const t = target()
    bar.open(host, t, 'needle')
    key('Enter')
    expect(t.findNext).toHaveBeenCalledWith('needle', false)
  })

  it('Shift+Enter finds the previous match', () => {
    const bar = createSearchBar()
    const t = target()
    bar.open(host, t, 'needle')
    key('Enter', { shiftKey: true })
    expect(t.findPrevious).toHaveBeenCalledWith('needle', false)
  })

  it('Escape closes, clears highlights and refocuses the terminal', () => {
    const bar = createSearchBar()
    const t = target()
    bar.open(host, t, '')
    key('Escape')
    expect(host.querySelector('.search-bar')).toBeNull()
    expect(t.clearSearch).toHaveBeenCalled()
    expect(t.focus).toHaveBeenCalled()
  })

  it('typing searches incrementally', () => {
    const bar = createSearchBar()
    const t = target()
    bar.open(host, t, '')
    input().value = 'err'
    input().dispatchEvent(new Event('input', { bubbles: true }))
    expect(t.findNext).toHaveBeenCalledWith('err', false, true)
  })

  it('opens seeded with the selection and searches it', () => {
    const bar = createSearchBar()
    const t = target()
    bar.open(host, t, 'seeded')
    expect(input().value).toBe('seeded')
    expect(t.findNext).toHaveBeenCalledWith('seeded', false, true)
  })

  it('reopening on the same pane keeps the bar', () => {
    const bar = createSearchBar()
    const t = target()
    bar.open(host, t, '')
    input().value = 'kept'
    bar.open(host, t, 'ignored')
    expect(host.querySelectorAll('.search-bar')).toHaveLength(1)
    expect(input().value).toBe('kept')
  })

  it('close is idempotent and safe before open', () => {
    const bar = createSearchBar()
    bar.close()
    const t = target()
    bar.open(host, t, '')
    bar.close()
    bar.close()
    expect(t.clearSearch).toHaveBeenCalledTimes(1)
  })
})
