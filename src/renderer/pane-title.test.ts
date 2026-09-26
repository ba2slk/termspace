import { describe, expect, it } from 'vitest'
import { DEFAULT_PANE_TITLE, isDefaultPaneTitle, neighbourName } from './pane-title'

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
