import { describe, expect, it } from 'vitest'
import { t } from './i18n'
import { matchField, type JumpEntry, type JumpResult } from './pane-jump-model'
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

/** The same entry, read as the ranking reads it for this query. */
function ranked(over: Partial<JumpEntry>, query: string): JumpResult {
  const { entry } = result(over)
  return {
    entry,
    name: matchField(query, entry.name),
    command: matchField(query, entry.command),
    windowTitle: matchField(query, entry.windowTitle),
  }
}

const marks = (row: HTMLElement): string[] =>
  [...row.querySelectorAll('.pane-jump__match')].map((mark) => mark.textContent ?? '')

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

  it('marks the matched letters of the command, leaving the line as it reads', () => {
    const row = buildRow(ranked({ command: 'npm run dev' }, 'nrd'), false)
    expect(marks(row).join('')).toBe('nrd')
    expect(text(row, 'sub')).toBe('npm run dev')
  })

  it('marks inside the name', () => {
    const row = buildRow(ranked({}, 'dev'), false)
    expect(row.querySelector('.pane-jump__name .pane-jump__match')?.textContent).toBe('dev')
    expect(text(row, 'name')).toBe('dev server')
  })

  it('marks the window title after the separator', () => {
    const row = buildRow(ranked({ command: 'nvim', windowTitle: 'layout-model.ts' }, 'lay'), false)
    const sep = row.querySelector('.pane-jump__sep')!
    const mark = row.querySelector('.pane-jump__match')!
    expect(sep.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(text(row, 'sub')).toBe('nvim · layout-model.ts')
  })

  it('marks nothing when no query landed', () => {
    expect(marks(buildRow(result({ command: 'npm run dev' }), false))).toEqual([])
  })

  it('renders a window title as text, never as markup', () => {
    const row = buildRow(ranked({ command: 'less', windowTitle: '<img src=x>' }, 'img'), false)
    expect(row.querySelector('img')).toBeNull()
    expect(marks(row).join('')).toBe('img')
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
