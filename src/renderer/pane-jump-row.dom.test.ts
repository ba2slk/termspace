import { describe, expect, it } from 'vitest'
import { t } from './i18n'
import type { JumpEntry, JumpResult } from './pane-jump-model'
import { buildEmptyRow, buildRow } from './pane-jump-row'

function result(over: Partial<JumpEntry> = {}): JumpResult {
  const entry: JumpEntry = {
    id: 'a',
    name: 'dev server',
    column: 2,
    command: '',
    windowTitle: '',
    focused: false,
    wants: false,
    ...over,
  }
  return { entry, name: null, command: null, windowTitle: null }
}

const text = (row: HTMLElement, part: string): string | undefined =>
  row.querySelector(`.pane-jump__${part}`)?.textContent ?? undefined

describe('buildRow', () => {
  it('carries the pane id and the pane name', () => {
    const row = buildRow(result(), false)
    expect(row.dataset.paneId).toBe('a')
    expect(text(row, 'name')).toBe('dev server')
  })

  it('dots a pane that wants attention, and only that one', () => {
    expect(buildRow(result({ wants: true }), false).querySelector('.pane-jump__dot')).not.toBeNull()
    expect(buildRow(result(), false).querySelector('.pane-jump__dot')).toBeNull()
  })

  it('tags the focused pane, and only that one', () => {
    expect(text(buildRow(result({ focused: true }), false), 'tag')).toBe(t.paneJump.current)
    expect(buildRow(result(), false).querySelector('.pane-jump__tag')).toBeNull()
  })

  it('says which column the pane is in', () => {
    expect(text(buildRow(result({ column: 3 }), false), 'where')).toBe(t.paneJump.column(3))
  })

  it('sub line is the command, the command and title, or nothing', () => {
    expect(text(buildRow(result({ command: 'nvim' }), false), 'sub')).toBe('nvim')
    expect(text(buildRow(result({ command: 'nvim', windowTitle: 'a.ts' }), false), 'sub')).toBe(
      'nvim · a.ts',
    )
    expect(text(buildRow(result(), false), 'sub')).toBe('')
  })

  it('marks the selected row', () => {
    expect(buildRow(result(), true).classList.contains('pane-jump__row--selected')).toBe(true)
    expect(buildRow(result(), false).classList.contains('pane-jump__row--selected')).toBe(false)
  })

  it('renders a window title as text, never as markup', () => {
    const row = buildRow(result({ command: 'less', windowTitle: '<img src=x>' }), false)
    expect(row.querySelector('img')).toBeNull()
    expect(text(row, 'sub')).toBe('less · <img src=x>')
  })
})

describe('buildEmptyRow', () => {
  it('stands in for the rows with the empty copy', () => {
    const empty = buildEmptyRow()
    expect(empty.className).toBe('pane-jump__empty')
    expect(empty.textContent).toBe(t.paneJump.empty)
  })
})
