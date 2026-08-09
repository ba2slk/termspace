import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createExampleSession,
  listSessions,
  loadSession,
  saveSession,
  sessionsDir,
} from './session-config'
import type { SessionDraft } from './session-writer'

let dir: string
const env = { HOME: '/home/u', SHELL: '/bin/bash' } as NodeJS.ProcessEnv

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'termspace-test-'))
})

describe('sessionsDir', () => {
  it('follows XDG_CONFIG_HOME when set', () => {
    expect(
      sessionsDir({ XDG_CONFIG_HOME: '/x/cfg', HOME: '/home/u' } as NodeJS.ProcessEnv),
    ).toBe('/x/cfg/termspace/sessions')
  })
  it('falls back to ~/.config', () => {
    expect(sessionsDir({ HOME: '/home/u' } as NodeJS.ProcessEnv)).toBe(
      '/home/u/.config/termspace/sessions',
    )
  })
})

describe('listSessions', () => {
  it('returns an empty list with no directory; a first run is not an error', async () => {
    expect(await listSessions(join(dir, 'nope'))).toEqual([])
  })

  it('reads yaml files in name order and counts panes', async () => {
    await writeFile(join(dir, 'b.yaml'), 'name: beta\ncolumns:\n  - panes:\n      - {}\n')
    await writeFile(join(dir, 'a.yaml'), 'name: alpha\ncolumns:\n  - panes:\n      - {}\n      - {}\n')
    const list = await listSessions(dir)
    expect(list.map((s) => s.name)).toEqual(['alpha', 'beta'])
    expect(list[0]!.paneCount).toBe(2)
    expect(list[0]!.error).toBeNull()
  })

  it('ignores non-yaml files', async () => {
    await writeFile(join(dir, 'README.md'), '# 메모')
    expect(await listSessions(dir)).toEqual([])
  })

  it('keeps an unopenable session in the list with its error', async () => {
    await writeFile(join(dir, 'broken.yaml'), 'columns: []\n')
    const list = await listSessions(dir)
    expect(list).toHaveLength(1)
    expect(list[0]!.error).not.toBeNull()
  })

  it('survives malformed YAML', async () => {
    await writeFile(join(dir, 'bad.yaml'), 'name: [불균형\n')
    await writeFile(join(dir, 'good.yaml'), 'name: ok\ncolumns:\n  - panes:\n      - {}\n')
    const list = await listSessions(dir)
    expect(list).toHaveLength(2)
    expect(list.find((s) => s.name === 'bad')!.error).toContain('YAML')
  })

  it('defaults the session name to the file name', async () => {
    await writeFile(join(dir, 'noname.yaml'), 'columns: []\n')
    expect((await listSessions(dir))[0]!.name).toBe('noname')
  })
})

describe('loadSession', () => {
  it('returns a SessionSpec for a sound file', async () => {
    await writeFile(
      join(dir, 'dev.yaml'),
      'name: dev\ncwd: ~/work\ncolumns:\n  - panes:\n      - command: htop\n',
    )
    const result = await loadSession(dir, 'dev', env)
    expect(result.ok).toBe(true)
    expect(result.spec!.cwd).toBe('/home/u/work')
    expect(result.spec!.shell).toBe('/bin/bash')
    expect(result.file).toBe(join(dir, 'dev.yaml'))
  })

  it('fails with a reason for a missing session', async () => {
    const result = await loadSession(dir, 'nope', env)
    expect(result.ok).toBe(false)
    expect(result.issues[0]!.message).toContain('not found')
  })

  it('rejects path separators in a session name', async () => {
    const result = await loadSession(dir, '../../etc/passwd', env)
    expect(result.ok).toBe(false)
  })
})

describe('createExampleSession', () => {
  it('creates the directory and writes the example', async () => {
    const target = join(dir, 'deep', 'sessions')
    const file = await createExampleSession(target)
    expect(file).toBe(join(target, 'example.yaml'))
    expect(await readFile(file, 'utf8')).toContain('name: example')
  })

  it('the example it writes opens without error', async () => {
    await createExampleSession(dir)
    const result = await loadSession(dir, 'example', env)
    expect(result.ok).toBe(true)
    expect(result.spec!.columns.length).toBeGreaterThan(0)
    // Every pane in the example must parse cleanly
    expect(result.spec!.columns.flatMap((c) => c.panes).every((p) => p.kind === 'pane')).toBe(true)
  })

  it('returns the existing path without overwriting', async () => {
    const file = await createExampleSession(dir)
    await writeFile(file, 'name: mine\ncolumns:\n  - panes:\n      - {}\n')
    await createExampleSession(dir)
    expect(await readFile(file, 'utf8')).toContain('name: mine')
  })
})

describe('saveSession', () => {
  const draft = (command: string): SessionDraft => ({
    name: 'demo',
    cwd: '/home/u',
    columns: [
      {
        width: 640,
        panes: [{ title: 'p', command, prefill: null, cwd: '/home/u', heightRatio: 1 }],
      },
    ],
  })

  it('keeps the previous file when overwriting', async () => {
    // A save reads live state; one bad reading must not be the end of the file.
    await saveSession(dir, 'demo', draft('first'), false, '/home/u')
    await saveSession(dir, 'demo', draft('second'), true, '/home/u')

    expect(await readFile(join(dir, 'demo.yaml'), 'utf8')).toContain('second')
    expect(await readFile(join(dir, 'demo.yaml.bak'), 'utf8')).toContain('first')
  })

  it('leaves no backup behind on a first save', async () => {
    await saveSession(dir, 'fresh', draft('only'), false, '/home/u')
    await expect(readFile(join(dir, 'fresh.yaml.bak'), 'utf8')).rejects.toThrow()
  })

  it('keeps backups out of the session list', async () => {
    await saveSession(dir, 'demo', draft('first'), false, '/home/u')
    await saveSession(dir, 'demo', draft('second'), true, '/home/u')
    expect((await listSessions(dir)).map((s) => s.id)).toEqual(['demo'])
  })
})
