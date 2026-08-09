import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { deepestCommonAncestor, isValidSessionId, toSessionYaml, type SessionDraft } from './session-writer'

const HOME = '/home/user'

const draft = (overrides: Partial<SessionDraft> = {}): SessionDraft => ({
  name: 'dev',
  cwd: HOME,
  columns: [
    {
      width: 640,
      panes: [{ title: 'shell', command: null, prefill: null, cwd: HOME, heightRatio: 1 }],
    },
  ],
  ...overrides,
})

const parsed = (d: SessionDraft): Record<string, unknown> =>
  parse(toSessionYaml(d, HOME)) as Record<string, unknown>

describe('isValidSessionId', () => {
  it('accepts letters, digits, dots, underscores and hyphens', () => {
    expect(isValidSessionId('dev')).toBe(true)
    expect(isValidSessionId('catch-up')).toBe(true)
    expect(isValidSessionId('작업_2')).toBe(true)
    expect(isValidSessionId('v1.2')).toBe(true)
  })

  it('rejects anything that could escape the folder', () => {
    // A leak here writes outside the sessions folder.
    expect(isValidSessionId('../etc/passwd')).toBe(false)
    expect(isValidSessionId('a/b')).toBe(false)
    expect(isValidSessionId('a\\b')).toBe(false)
    expect(isValidSessionId('a\0b')).toBe(false)
    expect(isValidSessionId('..')).toBe(false)
    expect(isValidSessionId('.hidden')).toBe(false)
    expect(isValidSessionId('-rf')).toBe(false)
  })

  it('rejects empty and overlong names', () => {
    expect(isValidSessionId('')).toBe(false)
    expect(isValidSessionId('a'.repeat(65))).toBe(false)
    expect(isValidSessionId('a'.repeat(64))).toBe(true)
  })
})

describe('toSessionYaml', () => {
  it('round-trips the layout', () => {
    const out = parsed(
      draft({
        columns: [
          {
            width: 720,
            panes: [
              { title: 'shell', command: null, prefill: null, cwd: HOME, heightRatio: 0.6 },
              { title: '로그', command: 'journalctl -f', prefill: null, cwd: `${HOME}/log`, heightRatio: 0.4 },
            ],
          },
          { width: 640, panes: [{ title: '홈', command: null, prefill: null, cwd: '/etc', heightRatio: 1 }] },
        ],
      }),
    )
    expect(out).toEqual({
      name: 'dev',
      cwd: '~',
      columns: [
        {
          width: 720,
          panes: [
            { title: 'shell', height: 0.6 },
            { title: '로그', cwd: 'log', command: 'journalctl -f', height: 0.4 },
          ],
        },
        { width: 640, panes: [{ title: '홈', cwd: '/etc' }] },
      ],
    })
  })

  it('writes the session root instead of hardcoding ~', () => {
    const out = parsed(draft({ cwd: `${HOME}/dev/proj` }))
    expect(out['cwd']).toBe('~/dev/proj')
  })

  it('omits cwd when it matches the session root', () => {
    const out = parsed(
      draft({
        cwd: `${HOME}/dev/proj`,
        columns: [
          {
            width: 640,
            panes: [{ title: 'shell', command: null, prefill: null, cwd: `${HOME}/dev/proj`, heightRatio: 1 }],
          },
        ],
      }),
    )
    const panes = (out['columns'] as { panes: Record<string, unknown>[] }[])[0]!.panes
    expect(panes[0]).not.toHaveProperty('cwd')
  })

  it('writes pane cwds under the root as relative, others ~-shortened', () => {
    const out = parsed(
      draft({
        cwd: `${HOME}/dev/proj`,
        columns: [
          {
            width: 640,
            panes: [
              { title: 'api', command: null, prefill: null, cwd: `${HOME}/dev/proj/api`, heightRatio: 0.4 },
              { title: 'notes', command: null, prefill: null, cwd: `${HOME}/notes`, heightRatio: 0.3 },
              { title: 'etc', command: null, prefill: null, cwd: '/etc', heightRatio: 0.3 },
            ],
          },
        ],
      }),
    )
    const panes = (out['columns'] as { panes: Record<string, unknown>[] }[])[0]!.panes
    expect(panes[0]!['cwd']).toBe('api')
    expect(panes[1]!['cwd']).toBe('~/notes')
    expect(panes[2]!['cwd']).toBe('/etc')
  })

  it('does not treat a sibling folder with the root as prefix as relative', () => {
    // /home/user/dev/proj-old is not inside /home/user/dev/proj.
    const out = parsed(
      draft({
        cwd: `${HOME}/dev/proj`,
        columns: [
          {
            width: 640,
            panes: [{ title: 'old', command: null, prefill: null, cwd: `${HOME}/dev/proj-old`, heightRatio: 1 }],
          },
        ],
      }),
    )
    const panes = (out['columns'] as { panes: Record<string, unknown>[] }[])[0]!.panes
    expect(panes[0]!['cwd']).toBe('~/dev/proj-old')
  })

  it('keeps prefill', () => {
    const out = parsed(
      draft({
        columns: [
          {
            width: 640,
            panes: [{ title: 'shell', command: null, prefill: 'npm run dev', cwd: HOME, heightRatio: 1 }],
          },
        ],
      }),
    )
    const panes = (out['columns'] as { panes: Record<string, unknown>[] }[])[0]!.panes
    expect(panes[0]!['prefill']).toBe('npm run dev')
  })

  it('omits empty prefill', () => {
    const panes = (parsed(draft())['columns'] as { panes: Record<string, unknown>[] }[])[0]!.panes
    expect(panes[0]).not.toHaveProperty('prefill')
  })

  it('omits height for a lone pane', () => {
    const panes = (parsed(draft())['columns'] as { panes: Record<string, unknown>[] }[])[0]!.panes
    expect(panes[0]).not.toHaveProperty('height')
  })

  it('rounds ratios to three decimals', () => {
    const out = parsed(
      draft({
        columns: [
          {
            width: 640,
            panes: [
              { title: 'a', command: null, prefill: null, cwd: HOME, heightRatio: 1 / 3 },
              { title: 'b', command: null, prefill: null, cwd: HOME, heightRatio: 2 / 3 },
            ],
          },
        ],
      }),
    )
    const panes = (out['columns'] as { panes: Record<string, unknown>[] }[])[0]!.panes
    expect(panes[0]!['height']).toBe(0.333)
    expect(panes[1]!['height']).toBe(0.667)
  })

  it('quotes ~, which YAML would otherwise read as null', () => {
    // Unquoted, cwd parses as null and the session starts anywhere.
    expect(parsed(draft())['cwd']).toBe('~')
  })

  it('round-trips titles and commands that look like YAML', () => {
    const nasty = 'yes: # no'
    const out = parsed(
      draft({
        name: nasty,
        columns: [
          { width: 640, panes: [{ title: nasty, command: nasty, prefill: null, cwd: HOME, heightRatio: 1 }] },
        ],
      }),
    )
    expect(out['name']).toBe(nasty)
    const panes = (out['columns'] as { panes: Record<string, unknown>[] }[])[0]!.panes
    expect(panes[0]!['title']).toBe(nasty)
    expect(panes[0]!['command']).toBe(nasty)
  })

  it('writes widths as integers', () => {
    const out = parsed(draft({ columns: [{ width: 640.4, panes: draft().columns[0]!.panes }] }))
    expect((out['columns'] as { width: number }[])[0]!.width).toBe(640)
  })

  it('starts with a header saying what the file is', () => {
    expect(toSessionYaml(draft(), HOME).startsWith('# Termspace session')).toBe(true)
  })
})

describe('deepestCommonAncestor', () => {
  it('returns the shared directory of all paths', () => {
    expect(deepestCommonAncestor(['/home/u/dev/proj/api', '/home/u/dev/proj/web'])).toBe(
      '/home/u/dev/proj',
    )
  })

  it('a single path is its own ancestor', () => {
    expect(deepestCommonAncestor(['/home/u/dev/proj'])).toBe('/home/u/dev/proj')
  })

  it('one path being the ancestor of the other works', () => {
    expect(deepestCommonAncestor(['/home/u/dev', '/home/u/dev/proj'])).toBe('/home/u/dev')
  })

  it('does not cut path segments in half', () => {
    // proj and proj-old share a string prefix but not a directory.
    expect(deepestCommonAncestor(['/home/u/proj', '/home/u/proj-old'])).toBe('/home/u')
  })

  it('unrelated paths meet at the filesystem root', () => {
    expect(deepestCommonAncestor(['/etc', '/var/log'])).toBe('/')
  })

  it('an empty list has no ancestor', () => {
    expect(deepestCommonAncestor([])).toBe(null)
  })
})
