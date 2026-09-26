import { describe, expect, it } from 'vitest'
import { barTitle, DEFAULT_PANE_TITLE, isDefaultPaneTitle, neighbourName } from './pane-title'

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

describe('neighbourName', () => {
  it('uses a title someone chose, trimmed', () => {
    expect(neighbourName('  api  ', 'node')).toBe('api')
  })

  it('falls back to what the pane is running when the title is the default', () => {
    expect(neighbourName(DEFAULT_PANE_TITLE, 'nvim')).toBe('nvim')
    expect(neighbourName('', '  htop ')).toBe('htop')
  })

  it('is null when there is neither a title nor a command', () => {
    expect(neighbourName(DEFAULT_PANE_TITLE, null)).toBeNull()
    expect(neighbourName(DEFAULT_PANE_TITLE, '   ')).toBeNull()
  })
})
