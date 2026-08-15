import { describe, expect, it } from 'vitest'
import { barTitle, DEFAULT_PANE_TITLE, isDefaultPaneTitle } from './pane-title'

const compose = (session: string, pane: string): string => `${session} · ${pane}`

describe('isDefaultPaneTitle', () => {
  it('is true for the default title and for nothing at all', () => {
    expect(isDefaultPaneTitle(DEFAULT_PANE_TITLE)).toBe(true)
    expect(isDefaultPaneTitle('  shell  ')).toBe(true)
    expect(isDefaultPaneTitle('')).toBe(true)
    expect(isDefaultPaneTitle('   ')).toBe(true)
  })

  it('is false for a title someone chose', () => {
    expect(isDefaultPaneTitle('server')).toBe(false)
    expect(isDefaultPaneTitle('shell two')).toBe(false)
  })
})

describe('barTitle', () => {
  it('adds the focused pane when it has a title', () => {
    expect(barTitle('work', 'server', compose)).toBe('work · server')
  })

  it('stays the session alone when the pane keeps the default title', () => {
    expect(barTitle('work', DEFAULT_PANE_TITLE, compose)).toBe('work')
  })

  it('stays the session alone when no pane is focused', () => {
    expect(barTitle('work', null, compose)).toBe('work')
  })

  it('trims the pane title it shows', () => {
    expect(barTitle('work', '  server  ', compose)).toBe('work · server')
  })
})
