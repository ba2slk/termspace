import { access, mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_BINDINGS, withChords } from '../shared/keybindings'
import { keybindingsFile, loadKeybindings, saveKeybindings } from './keybindings-file'

let env: NodeJS.ProcessEnv

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'termspace-keys-'))
  env = { XDG_CONFIG_HOME: dir, HOME: '/home/u' } as NodeJS.ProcessEnv
})

const writeFileAt = async (text: string): Promise<void> => {
  const path = keybindingsFile(env)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text, 'utf8')
}

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

describe('keybindingsFile', () => {
  it('follows XDG_CONFIG_HOME when set', () => {
    expect(keybindingsFile({ XDG_CONFIG_HOME: '/x/cfg' } as NodeJS.ProcessEnv)).toBe(
      '/x/cfg/termspace/keybindings.yaml',
    )
  })

  it('falls back to ~/.config', () => {
    expect(keybindingsFile({ HOME: '/home/u' } as NodeJS.ProcessEnv)).toBe(
      '/home/u/.config/termspace/keybindings.yaml',
    )
  })
})

describe('loadKeybindings', () => {
  it('uses the defaults when there is no file', async () => {
    expect(await loadKeybindings(env)).toEqual(DEFAULT_BINDINGS)
  })

  it('uses the defaults when the file is not YAML', async () => {
    await writeFileAt('overview: [unclosed\n')
    expect(await loadKeybindings(env)).toEqual(DEFAULT_BINDINGS)
  })

  it('keeps the defaults for rows the file does not mention', async () => {
    await writeFileAt('overview: Alt+Space\n')
    const bindings = await loadKeybindings(env)
    expect(bindings['overview']).toEqual(['Alt+Space'])
    expect(bindings['toggle-sidebar']).toEqual(DEFAULT_BINDINGS['toggle-sidebar'])
  })
})

describe('saveKeybindings', () => {
  it('writes only what differs, and reads back the same', async () => {
    const changed = withChords(DEFAULT_BINDINGS, 'overview', ['Alt+Space'])
    expect(await saveKeybindings(env, changed)).toEqual(changed)
    expect(await loadKeybindings(env)).toEqual(changed)

    const text = await readFile(keybindingsFile(env), 'utf8')
    expect(text).toContain('overview')
    expect(text).not.toContain('toggle-sidebar')
  })

  it('removes the file once everything is back to default', async () => {
    await saveKeybindings(env, withChords(DEFAULT_BINDINGS, 'overview', ['Alt+Space']))
    await saveKeybindings(env, DEFAULT_BINDINGS)
    expect(await exists(keybindingsFile(env))).toBe(false)
    expect(await loadKeybindings(env)).toEqual(DEFAULT_BINDINGS)
  })

  it('saves nothing at all when nothing was ever changed', async () => {
    await saveKeybindings(env, DEFAULT_BINDINGS)
    expect(await exists(keybindingsFile(env))).toBe(false)
  })

  it('drops an unusable chord before it reaches the file', async () => {
    const saved = await saveKeybindings(env, { overview: ['Alt+Banana', 'Alt+Space'] })
    expect(saved['overview']).toEqual(['Alt+Space'])
  })
})
