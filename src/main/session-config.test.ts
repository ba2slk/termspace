import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createExampleSession,
  listSessions,
  loadSession,
  renameSessionName,
  reorderSession,
  saveSession,
  sessionsDir,
} from './session-config'
import type { SessionDraft } from './session-writer'

let dir: string
const env = { HOME: '/home/u', SHELL: '/bin/bash' } as NodeJS.ProcessEnv

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'termspace-test-'))
})

const orderPath = (): string => join(dir, 'order.json')

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
    expect(await listSessions(join(dir, 'nope'), orderPath())).toEqual([])
  })

  it('reads yaml files and counts panes', async () => {
    await writeFile(join(dir, 'b.yaml'), 'name: beta\ncolumns:\n  - panes:\n      - {}\n')
    await writeFile(join(dir, 'a.yaml'), 'name: alpha\ncolumns:\n  - panes:\n      - {}\n      - {}\n')
    const list = await listSessions(dir, orderPath())
    expect([...list].map((s) => s.name).sort()).toEqual(['alpha', 'beta'])
    expect(list.find((s) => s.name === 'alpha')!.paneCount).toBe(2)
    expect(list[0]!.error).toBeNull()
  })

  it('ignores non-yaml files', async () => {
    await writeFile(join(dir, 'README.md'), '# 메모')
    expect(await listSessions(dir, orderPath())).toEqual([])
  })

  it('keeps an unopenable session in the list with its error', async () => {
    await writeFile(join(dir, 'broken.yaml'), 'columns: []\n')
    const list = await listSessions(dir, orderPath())
    expect(list).toHaveLength(1)
    expect(list[0]!.error).not.toBeNull()
  })

  it('survives malformed YAML', async () => {
    await writeFile(join(dir, 'bad.yaml'), 'name: [불균형\n')
    await writeFile(join(dir, 'good.yaml'), 'name: ok\ncolumns:\n  - panes:\n      - {}\n')
    const list = await listSessions(dir, orderPath())
    expect(list).toHaveLength(2)
    expect(list.find((s) => s.name === 'bad')!.error).toContain('YAML')
  })

  it('defaults the session name to the file name', async () => {
    await writeFile(join(dir, 'noname.yaml'), 'columns: []\n')
    expect((await listSessions(dir, orderPath()))[0]!.name).toBe('noname')
  })
})

describe('listSessions ordering', () => {
  const write = (name: string) =>
    writeFile(join(dir, `${name}.yaml`), `name: ${name}\ncolumns:\n  - panes:\n      - {}\n`)

  it('follows the recorded order', async () => {
    await write('a')
    await write('b')
    await write('c')
    await writeFile(orderPath(), JSON.stringify(['c', 'a', 'b']))
    const list = await listSessions(dir, orderPath())
    expect(list.map((s) => s.id)).toEqual(['c', 'a', 'b'])
  })

  it('puts a session the order does not know after the ones it does', async () => {
    await write('a')
    await write('b')
    await writeFile(orderPath(), JSON.stringify(['b']))
    const list = await listSessions(dir, orderPath())
    expect(list.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('writes the resolved order back so the first run seeds the file', async () => {
    await write('a')
    await write('b')
    await listSessions(dir, orderPath())
    expect(JSON.parse(await readFile(orderPath(), 'utf8'))).toEqual(['a', 'b'])
  })

  it('prunes an id whose file is gone', async () => {
    await write('a')
    await writeFile(orderPath(), JSON.stringify(['gone', 'a']))
    await listSessions(dir, orderPath())
    expect(JSON.parse(await readFile(orderPath(), 'utf8'))).toEqual(['a'])
  })

  it('treats a corrupt order file as no order and rewrites it', async () => {
    await write('a')
    await writeFile(orderPath(), 'not json at all')
    const list = await listSessions(dir, orderPath())
    expect(list.map((s) => s.id)).toEqual(['a'])
    expect(JSON.parse(await readFile(orderPath(), 'utf8'))).toEqual(['a'])
  })

  it('reports a creation time for every session, error or not', async () => {
    await write('a')
    await writeFile(join(dir, 'broken.yaml'), 'columns: []\n')
    const list = await listSessions(dir, orderPath())
    expect(list).toHaveLength(2)
    for (const s of list) expect(s.createdMs).toBeGreaterThan(0)
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
    expect((await listSessions(dir, orderPath())).map((s) => s.id)).toEqual(['demo'])
  })
})

describe('renameSessionName', () => {
  it('replaces the name, keeping comments and layout untouched', async () => {
    const file = join(dir, 'proj.yaml')
    await writeFile(
      file,
      '# my notes\nname: old\ncwd: "~"\ncolumns:\n  - width: 640\n    panes:\n      - title: shell\n',
      'utf8',
    )
    const result = await renameSessionName(dir, 'proj', 'new name', orderPath())
    expect(result.ok).toBe(true)
    const moved = join(dir, 'new-name.yaml')
    const text = await readFile(moved, 'utf8')
    expect(text).toContain('name: new name')
    expect(text).toContain('# my notes')
    expect(text).toContain('title: shell')
    expect(await readFile(`${moved}.bak`, 'utf8')).toContain('name: old')
    expect(file).toBe(join(dir, 'proj.yaml'))
  })

  it('moves the file to the name the user typed', async () => {
    await writeFile(join(dir, 'proj.yaml'), '# my notes\nname: old\ncwd: "~"\n', 'utf8')
    const result = await renameSessionName(dir, 'proj', 'catch up', orderPath())
    expect(result.ok).toBe(true)
    expect(result.file).toBe(join(dir, 'catch-up.yaml'))
    expect(await readFile(join(dir, 'catch-up.yaml'), 'utf8')).toContain('name: catch up')
    await expect(readFile(join(dir, 'proj.yaml'), 'utf8')).rejects.toThrow()
    // The new file's one undo is what stood before the rename.
    expect(await readFile(join(dir, 'catch-up.yaml.bak'), 'utf8')).toContain('name: old')
  })

  it('refuses a name whose file already exists, and writes nothing', async () => {
    await writeFile(join(dir, 'proj.yaml'), 'name: old\n', 'utf8')
    await writeFile(join(dir, 'taken.yaml'), 'name: taken\n', 'utf8')
    const result = await renameSessionName(dir, 'proj', 'taken', orderPath())
    expect(result.ok).toBe(false)
    expect(result.error).toContain('already exists')
    expect(await readFile(join(dir, 'proj.yaml'), 'utf8')).toContain('name: old')
    expect(await readFile(join(dir, 'taken.yaml'), 'utf8')).toContain('name: taken')
  })

  it('stays in place when the name still derives the same id', async () => {
    await writeFile(join(dir, 'proj.yaml'), 'name: old\n', 'utf8')
    const result = await renameSessionName(dir, 'proj', 'proj', orderPath())
    expect(result.ok).toBe(true)
    expect(result.file).toBe(join(dir, 'proj.yaml'))
    expect(await readFile(join(dir, 'proj.yaml'), 'utf8')).toContain('name: proj')
  })

  it('stays in place when the name derives no id at all', async () => {
    await writeFile(join(dir, 'proj.yaml'), 'name: old\n', 'utf8')
    const result = await renameSessionName(dir, 'proj', '///', orderPath())
    expect(result.ok).toBe(true)
    expect(result.file).toBe(join(dir, 'proj.yaml'))
    expect(await readFile(join(dir, 'proj.yaml'), 'utf8')).toContain('name: ///')
  })

  it('rejects an empty name', async () => {
    const result = await renameSessionName(dir, 'proj', '   ', orderPath())
    expect(result.ok).toBe(false)
  })

  it('reports a missing session', async () => {
    const result = await renameSessionName(dir, 'nope', 'x', orderPath())
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('refuses to rewrite a file with YAML syntax errors', async () => {
    await writeFile(join(dir, 'bad.yaml'), 'name: [unclosed\n', 'utf8')
    const result = await renameSessionName(dir, 'bad', 'x', orderPath())
    expect(result.ok).toBe(false)
  })
})

describe('reorderSession', () => {
  const write = (name: string) =>
    writeFile(join(dir, `${name}.yaml`), `name: ${name}\ncolumns:\n  - panes:\n      - {}\n`)

  it('moves a session and returns the new list', async () => {
    await write('a')
    await write('b')
    await write('c')
    await listSessions(dir, orderPath())
    const list = await reorderSession(dir, orderPath(), 'a', 2)
    expect(list.map((s) => s.id)).toEqual(['b', 'c', 'a'])
    expect(JSON.parse(await readFile(orderPath(), 'utf8'))).toEqual(['b', 'c', 'a'])
  })

  it('moves a session the order file has never seen', async () => {
    await write('a')
    await write('b')
    const list = await reorderSession(dir, orderPath(), 'b', 0)
    expect(list.map((s) => s.id)).toEqual(['b', 'a'])
  })
})

describe('renameSessionName and the order', () => {
  it('keeps the session where it was when the file moves', async () => {
    for (const n of ['a', 'b', 'c'])
      await writeFile(join(dir, `${n}.yaml`), `name: ${n}\ncolumns:\n  - panes:\n      - {}\n`)
    await listSessions(dir, orderPath())
    await renameSessionName(dir, 'b', 'zulu', orderPath())
    const list = await listSessions(dir, orderPath())
    expect(list.map((s) => s.id)).toEqual(['a', 'zulu', 'c'])
  })

  it('leaves the order alone when the file name does not change', async () => {
    await writeFile(join(dir, 'a.yaml'), 'name: a\ncolumns:\n  - panes:\n      - {}\n')
    await listSessions(dir, orderPath())
    await renameSessionName(dir, 'a', 'a but nicer', orderPath())
    expect(JSON.parse(await readFile(orderPath(), 'utf8'))).toEqual(['a-but-nicer'])
  })
})
