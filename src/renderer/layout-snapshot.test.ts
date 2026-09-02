import { describe, expect, it } from 'vitest'
import type { PaneSpec } from '../shared/protocol'
import { createLayout } from './layout-model'
import { layoutSnapshot } from './layout-snapshot'

const paneSpec = (over: Partial<PaneSpec> = {}): PaneSpec => ({
  kind: 'pane',
  title: 'shell',
  command: null,
  prefill: null,
  cwd: '/home/me/work',
  heightRatio: 1,
  minimized: false,
  ...over,
})

const twoColumns = createLayout([
  { id: 'c1', width: 700, panes: [{ id: 'p1', title: 'edit' }, { id: 'p2', title: 'logs' }] },
  { id: 'c2', width: 400, panes: [{ id: 'p3', title: 'shell' }] },
])

describe('the layout a save writes', () => {
  it('keeps the columns, their widths and their panes in order', () => {
    const snapshot = layoutSnapshot(twoColumns, new Map(), '/root')
    expect(snapshot.columns.map((c) => c.width)).toEqual([700, 400])
    expect(snapshot.columns.map((c) => c.panes.map((p) => p.title))).toEqual([
      ['edit', 'logs'],
      ['shell'],
    ])
  })

  it('records the pane ids, which is how main finds the live cwd', () => {
    const snapshot = layoutSnapshot(twoColumns, new Map(), '/root')
    expect(snapshot.columns.flatMap((c) => c.panes.map((p) => p.paneId))).toEqual([
      'p1', 'p2', 'p3',
    ])
  })

  it('carries the heights, which the file stores as shares of the column', () => {
    const snapshot = layoutSnapshot(twoColumns, new Map(), '/root')
    expect(snapshot.columns[0]?.panes.map((p) => p.heightRatio)).toEqual([0.5, 0.5])
    expect(snapshot.columns[1]?.panes[0]?.heightRatio).toBe(1)
  })

  /* The command came from the file and was never on screen; a save that dropped
   * it would turn a session that runs something into a session of bare shells. */
  it('carries the command and the prefill through untouched', () => {
    const snapshot = layoutSnapshot(
      twoColumns,
      new Map([
        ['p1', paneSpec({ command: 'nvim .' })],
        ['p2', paneSpec({ prefill: 'npm test' })],
      ]),
      '/root',
    )
    expect(snapshot.columns[0]?.panes[0]?.command).toBe('nvim .')
    expect(snapshot.columns[0]?.panes[0]?.prefill).toBeNull()
    expect(snapshot.columns[0]?.panes[1]?.prefill).toBe('npm test')
    expect(snapshot.columns[0]?.panes[1]?.command).toBeNull()
  })

  it('falls back to the path the pane itself started in', () => {
    const snapshot = layoutSnapshot(
      twoColumns,
      new Map([['p1', paneSpec({ cwd: '/home/me/work' })]]),
      '/root',
    )
    expect(snapshot.columns[0]?.panes[0]?.fallbackCwd).toBe('/home/me/work')
  })

  /* A pane split at runtime was never in a file, so it has no spec of its own. */
  it('falls back to the session root for a pane the file never named', () => {
    const snapshot = layoutSnapshot(twoColumns, new Map(), '/root')
    const panes = snapshot.columns.flatMap((c) => c.panes)
    expect(panes.map((p) => p.fallbackCwd)).toEqual(['/root', '/root', '/root'])
    expect(panes.map((p) => p.command)).toEqual([null, null, null])
  })

  /* Folding is a layout decision like any other, so a save keeps it — and the
   * ratio it wrote is the height the pane comes back to. */
  it('records which panes are folded right now', () => {
    const folded = createLayout([
      {
        id: 'c1',
        width: 640,
        panes: [
          { id: 'p1', title: 'edit' },
          { id: 'p2', title: 'logs', minimized: true },
        ],
      },
    ])
    const snapshot = layoutSnapshot(folded, new Map(), '/root')
    expect(snapshot.columns[0]?.panes.map((p) => p.minimized)).toEqual([false, true])
  })

  it('renames nothing: a pane title edited on screen is what gets written', () => {
    const renamed = createLayout([
      { id: 'c1', width: 640, panes: [{ id: 'p1', title: 'build watcher' }] },
    ])
    const snapshot = layoutSnapshot(renamed, new Map([['p1', paneSpec({ title: 'shell' })]]), '/root')
    expect(snapshot.columns[0]?.panes[0]?.title).toBe('build watcher')
  })
})
