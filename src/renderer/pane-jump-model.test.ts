import { describe, expect, it } from 'vitest'
import { matchField, rankEntries, type JumpEntry } from './pane-jump-model'

const entry = (id: string, over: Partial<JumpEntry> = {}): JumpEntry => ({
  id,
  name: 'shell',
  column: 1,
  command: '',
  windowTitle: '',
  focused: false,
  wants: false,
  ...over,
})

describe('matchField', () => {
  it('matches characters in order, across gaps', () => {
    expect(matchField('nrd', 'npm run dev')?.positions).toEqual([0, 4, 8])
  })

  it('rejects characters out of order', () => {
    expect(matchField('drn', 'npm run dev')).toBeNull()
  })

  it('ignores case', () => {
    expect(matchField('NV', 'nvim')?.positions).toEqual([0, 1])
  })

  it('prefers a word start over an earlier mid-word hit', () => {
    // "d" occurs inside "and" first; the word start in "dev" is the better reading.
    expect(matchField('d', 'and dev')?.positions).toEqual([4])
  })

  it('scores a contiguous run above a scattered one', () => {
    const run = matchField('run', 'npm run dev')!
    const scattered = matchField('run', 'r u n')!
    expect(run.score).toBeGreaterThan(scattered.score)
  })
})

describe('rankEntries', () => {
  const panes = [
    entry('a', { name: 'dev server', command: 'npm run dev', column: 1 }),
    entry('b', { name: 'tests', command: 'npm run test:watch', column: 2 }),
    entry('c', { name: 'editor', command: 'nvim', windowTitle: 'layout-model.ts', column: 3 }),
  ]

  it('an empty query lists everything in the order given, unmatched', () => {
    const all = rankEntries('', panes)
    expect(all.map((r) => r.entry.id)).toEqual(['a', 'b', 'c'])
    expect(all[0]).toMatchObject({ name: null, command: null, windowTitle: null })
  })

  it('whitespace in the query is ignored', () => {
    expect(rankEntries(' n r d ', panes).map((r) => r.entry.id)).toEqual(['a'])
  })

  it('drops entries where no field matches', () => {
    expect(rankEntries('zzz', panes)).toEqual([])
  })

  it('ties keep the order given', () => {
    expect(rankEntries('npm', panes).map((r) => r.entry.id)).toEqual(['a', 'b'])
  })

  it('matches on the window title and reports where', () => {
    const [hit] = rankEntries('lay', panes)
    expect(hit?.entry.id).toBe('c')
    expect(hit?.windowTitle?.positions).toEqual([0, 1, 2])
  })

  it('a name match outranks the same match in a command', () => {
    const two = [entry('cmd', { command: 'logs' }), entry('named', { name: 'logs' })]
    expect(rankEntries('logs', two).map((r) => r.entry.id)).toEqual(['named', 'cmd'])
  })
})
