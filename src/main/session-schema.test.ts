import { describe, expect, it } from 'vitest'
import { parseSession, resolveCwd, type ParseEnv } from './session-schema'

const env: ParseEnv = { home: '/home/u', shell: '/usr/bin/zsh' }

const valid = {
  name: 'dev',
  cwd: '~/dev/app',
  columns: [
    {
      width: 720,
      panes: [{ title: 'editor', command: 'nvim .' }, { title: 'shell', height: 0.3 }],
    },
    { panes: [{ title: 'server', cwd: './backend', command: 'uv run fastapi dev' }] },
  ],
}

const ok = (raw: unknown) => {
  const result = parseSession(raw, env)
  if (!result.ok) throw new Error(`parse failed: ${JSON.stringify(result.issues)}`)
  return result.spec
}

describe('resolveCwd', () => {
  it('expands ~ to home', () => {
    expect(resolveCwd('/base', '~/dev', '/home/u')).toBe('/home/u/dev')
    expect(resolveCwd('/base', '~', '/home/u')).toBe('/home/u')
  })
  it('leaves absolute paths alone', () => {
    expect(resolveCwd('/base', '/etc/nginx', '/home/u')).toBe('/etc/nginx')
  })
  it('resolves relative paths against the base', () => {
    expect(resolveCwd('/home/u/app', './backend', '/home/u')).toBe('/home/u/app/backend')
    expect(resolveCwd('/home/u/app', '../other', '/home/u')).toBe('/home/u/other')
  })
  it('leaves ~-prefixed names that are not home', () => {
    expect(resolveCwd('/base', '~backup', '/home/u')).toBe('/base/~backup')
  })
})

describe('parseSession — valid input', () => {
  it('fills in session defaults', () => {
    const spec = ok(valid)
    expect(spec.name).toBe('dev')
    expect(spec.cwd).toBe('/home/u/dev/app')
    expect(spec.shell).toBe('/usr/bin/zsh')
  })

  it('falls back to $SHELL, then /bin/sh', () => {
    expect(ok({ ...valid, shell: '/bin/fish' }).shell).toBe('/bin/fish')
    const noShell = parseSession(valid, { home: '/home/u', shell: null })
    expect(noShell.ok && noShell.spec.shell).toBe('/bin/sh')
  })

  it('defaults cwd to home', () => {
    const { cwd: _cwd, ...rest } = valid
    expect(ok(rest).cwd).toBe('/home/u')
  })

  it('resolves pane cwd against the session cwd', () => {
    const pane = ok(valid).columns[1]!.panes[0]!
    expect(pane.kind === 'pane' && pane.cwd).toBe('/home/u/dev/app/backend')
  })

  it('inherits the session cwd when a pane omits it', () => {
    const pane = ok(valid).columns[0]!.panes[0]!
    expect(pane.kind === 'pane' && pane.cwd).toBe('/home/u/dev/app')
  })

  it('defaults the column width', () => {
    expect(ok(valid).columns[1]!.width).toBe(640)
  })

  it('defaults the title to the command\'s first word', () => {
    const spec = ok({ name: 'x', columns: [{ panes: [{ command: 'lazygit --path .' }] }] })
    const pane = spec.columns[0]!.panes[0]!
    expect(pane.kind === 'pane' && pane.title).toBe('lazygit')
  })

  it('defaults the title to shell', () => {
    const spec = ok({ name: 'x', columns: [{ panes: [{}] }] })
    const pane = spec.columns[0]!.panes[0]!
    expect(pane.kind === 'pane' && pane.title).toBe('shell')
  })

  it('prefill is typed but not run', () => {
    const spec = ok({
      name: 'x',
      columns: [{ panes: [{ title: '배포', prefill: 'cu start full' }] }],
    })
    const pane = spec.columns[0]!.panes[0]!
    expect(pane.kind === 'pane' && pane.prefill).toBe('cu start full')
    expect(pane.kind === 'pane' && pane.command).toBeNull()
  })

  it('prefill is null when absent', () => {
    const pane = ok(valid).columns[0]!.panes[0]!
    expect(pane.kind === 'pane' && pane.prefill).toBeNull()
  })

  it('command is null when absent', () => {
    const pane = ok(valid).columns[0]!.panes[1]!
    expect(pane.kind === 'pane' && pane.command).toBeNull()
  })
})

describe('parseSession — height distribution', () => {
  it('honours explicit heights and splits the rest evenly', () => {
    const spec = ok({ name: 'x', columns: [{ panes: [{ height: 0.5 }, {}, {}] }] })
    expect(spec.columns[0]!.panes.map((p) => p.heightRatio)).toEqual([0.5, 0.25, 0.25])
  })

  it('distributes evenly when all are omitted', () => {
    const spec = ok({ name: 'x', columns: [{ panes: [{}, {}, {}, {}] }] })
    expect(spec.columns[0]!.panes.every((p) => Math.abs(p.heightRatio - 0.25) < 1e-9)).toBe(true)
  })

  it('uses explicit heights as given when they total 1', () => {
    const spec = ok({ name: 'x', columns: [{ panes: [{ height: 0.3 }, { height: 0.7 }] }] })
    expect(spec.columns[0]!.panes.map((p) => p.heightRatio)).toEqual([0.3, 0.7])
    expect(spec.columns[0]!.panes.every((p) => p.kind === 'pane')).toBe(true)
  })

  it('normalises explicit heights, keeping their ratio', () => {
    const spec = ok({ name: 'x', columns: [{ panes: [{ height: 0.2 }, { height: 0.6 }] }] })
    expect(spec.columns[0]!.panes[0]!.heightRatio).toBeCloseTo(0.25, 9)
    expect(spec.columns[0]!.panes[1]!.heightRatio).toBeCloseTo(0.75, 9)
  })

  it('errors when explicit heights leave nothing for the rest', () => {
    // Nothing left for the third pane — which is why a total of 1 is an error.
    const spec = ok({ name: 'x', columns: [{ panes: [{ height: 0.6 }, { height: 0.5 }, {}] }] })
    const entry = spec.columns[0]!.panes[0]!
    expect(entry.kind).toBe('error')
    expect(entry.kind === 'error' && entry.issue.message).toContain('height')
    expect(spec.columns[0]!.panes).toHaveLength(1)
  })
})

describe('parseSession — error isolation', () => {
  it('one bad pane leaves the rest intact', () => {
    const spec = ok({
      name: 'x',
      columns: [{ panes: [{ command: 'nvim' }, { command: 123 }, { command: 'htop' }] }],
    })
    expect(spec.columns[0]!.panes.map((p) => p.kind)).toEqual(['pane', 'error', 'pane'])
  })

  it('an error pane still takes its vertical slot', () => {
    const spec = ok({ name: 'x', columns: [{ panes: [{}, { command: 123 }] }] })
    expect(spec.columns[0]!.panes[1]!.heightRatio).toBeCloseTo(0.5, 9)
  })

  it('a pane can start folded, and open is the default', () => {
    const spec = ok({ name: 'x', columns: [{ panes: [{ title: 'a' }, { title: 'b', minimized: true }] }] })
    const [open, folded] = [spec.columns[0]!.panes[0]!, spec.columns[0]!.panes[1]!]
    expect(open.kind === 'pane' && open.minimized).toBe(false)
    expect(folded.kind === 'pane' && folded.minimized).toBe(true)
  })

  it('a folded pane keeps its share of the column', () => {
    const spec = ok({
      name: 'x',
      columns: [{ panes: [{ title: 'a' }, { title: 'b', height: 0.3, minimized: true }] }],
    })
    expect(spec.columns[0]!.panes[1]!.heightRatio).toBeCloseTo(0.3, 9)
  })

  it('errors carry their YAML path', () => {
    const spec = ok({ name: 'x', columns: [{ panes: [{}, { height: 5 }] }] })
    const entry = spec.columns[0]!.panes[1]!
    expect(entry.kind === 'error' && entry.issue.path).toBe('columns[0].panes[1].height')
  })

  it('catches unknown keys as typos', () => {
    const spec = ok({ name: 'x', columns: [{ panes: [{ commnad: 'nvim' }] }] })
    const entry = spec.columns[0]!.panes[0]!
    expect(entry.kind === 'error' && entry.issue.message).toContain('commnad')
  })

  it('a wholly invalid column becomes a single error card', () => {
    const spec = ok({ name: 'x', columns: [{ panes: [{}] }, { panes: [] }] })
    expect(spec.columns).toHaveLength(2)
    expect(spec.columns[1]!.panes).toHaveLength(1)
    expect(spec.columns[1]!.panes[0]!.kind).toBe('error')
  })

  it('a missing name fails the whole session', () => {
    const result = parseSession({ columns: [{ panes: [{}] }] }, env)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.issues[0]!.path).toBe('name')
  })

  it('empty columns fail the whole session', () => {
    expect(parseSession({ name: 'x', columns: [] }, env).ok).toBe(false)
  })

  it('a non-object YAML fails the whole session', () => {
    expect(parseSession('그냥 문자열', env).ok).toBe(false)
    expect(parseSession(null, env).ok).toBe(false)
  })
})
