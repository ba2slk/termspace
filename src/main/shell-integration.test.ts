import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node-pty'
import { describe, expect, it } from 'vitest'
import { HOOK_SCRIPT, HOOK_SCRIPT_ZSH, RC_LINE_ZSH, shellIntegrationFileZsh } from './shell-integration'
import { NO_SIGNALS, scanTerminalSignals } from './terminal-signals'

/*
 * The hook is bash, so only bash can say whether it works — and the one bug it
 * has had was invisible to every other kind of test. A DEBUG trap fires for
 * PROMPT_COMMAND's own commands as well as for submitted lines, and $HISTCMD is
 * the same in both, so with a prompt framework installed the hook reported the
 * *previous* history entry. On a fresh shell that entry is the last line of the
 * shared history file, so every pane reported the same unrelated command and
 * saving a layout wrote it into all of them.
 *
 * The environment below is therefore not incidental: a seeded shared history
 * and a PROMPT_COMMAND are what it takes to see that failure.
 *
 * The shell runs under node-pty rather than `script`: the hook only speaks on a
 * terminal, and the two `script` implementations disagree about both their
 * argv and whether stdin may be a pipe. node-pty is also what the app itself
 * uses, so this drives the hook the way a pane does.
 */

const hasBash = ((): boolean => {
  try {
    execFileSync('sh', ['-c', 'command -v bash'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const hasZsh = ((): boolean => {
  try {
    execFileSync('sh', ['-c', 'command -v zsh'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const PRIOR = 'PRIOR_COMMAND_FROM_ANOTHER_SHELL'
const SEQUENCE = /\u001b\]1173;([^\u0007]*)\u0007/g

interface Session {
  readonly sourced: boolean
  readonly commands: readonly string[]
  readonly output: string
}

/** Feed lines to an interactive shell on a pty and collect everything it printed. */
async function runShell(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  lines: readonly string[],
): Promise<string> {
  const term = spawn(file, [...args], {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    env: { ...process.env, TERM: 'xterm-256color', ...env },
  })

  let output = ''
  let exited = false
  term.onData((data) => {
    output += data
  })
  term.onExit(() => {
    exited = true
  })

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  /*
   * Wait for the shell to go quiet rather than for a prompt string: readline
   * only takes a line once it has finished drawing, and PS1 differs per rcfile.
   */
  const settle = async (): Promise<void> => {
    let seen = -1
    while (seen !== output.length && !exited) {
      seen = output.length
      await sleep(150)
    }
  }

  const deadline = setTimeout(() => {
    term.kill()
  }, 20_000)
  try {
    await settle()
    for (const line of lines) {
      term.write(`${line}\r`)
      await settle()
    }
    term.write('exit\r')
    for (let i = 0; i < 100 && !exited; i++) await sleep(50)
  } finally {
    clearTimeout(deadline)
    if (!exited) term.kill()
  }
  return output
}

/** Run one interactive bash under a pty, feed it lines, read back what the hook sent. */
async function runHookedShell(lines: readonly string[]): Promise<Session> {
  const dir = mkdtempSync(join(tmpdir(), 'termspace-hook-'))
  try {
    writeFileSync(join(dir, 'hook.bash'), HOOK_SCRIPT)
    writeFileSync(join(dir, 'history'), `${PRIOR}\n`)
    writeFileSync(
      join(dir, 'rc'),
      [
        'HISTCONTROL=ignoreboth',
        `HISTFILE=${join(dir, 'history')}`,
        'history -c',
        'history -r',
        // A prompt framework, which is what made the trap fire twice per line.
        '__probe_precmd() { :; }',
        'PROMPT_COMMAND=__probe_precmd',
        "alias compound='echo one && echo two; echo three'",
        `. ${join(dir, 'hook.bash')}`,
        '',
      ].join('\n'),
    )

    const output = await runShell('bash', ['--rcfile', join(dir, 'rc'), '-i'], { TERM_PROGRAM: 'Termspace' }, lines)

    let sourced = false
    const commands: string[] = []
    for (const match of output.matchAll(SEQUENCE)) {
      const body = match[1] ?? ''
      if (body === 'A') sourced = true
      else if (body.startsWith('C;')) {
        commands.push(Buffer.from(body.slice(2), 'base64').toString('utf8'))
      }
    }
    return { sourced, commands, output }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(!hasBash)('the bash hook', () => {
  it('reports each submitted line once, and nothing it was not given', async () => {
    const session = await runHookedShell(['echo hello', 'compound', 'echo done'])

    expect(session.sourced).toBe(true)
    // 'compound' once rather than once per component, and by name, not by body.
    expect(session.commands).toEqual(['echo hello', 'compound', 'echo done', 'exit'])
  }, 30_000)

  it('never reports a command another shell left in the shared history', async () => {
    expect((await runHookedShell(['echo hello'])).commands).not.toContain(PRIOR)
  }, 30_000)

  it('leaves the exit status of the previous command alone', async () => {
    // The trap runs before every command, and a careless one clobbers $?.
    const session = await runHookedShell(['false', 'echo status=$?'])
    expect(session.output).toContain('status=1')
  }, 30_000)

  it('stays silent outside Termspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'termspace-hook-'))
    try {
      writeFileSync(join(dir, 'hook.bash'), HOOK_SCRIPT)
      const output = await runShell(
        'bash',
        ['--rcfile', join(dir, 'hook.bash'), '-i'],
        { TERM_PROGRAM: 'SomeOtherTerminal' },
        ['echo hello'],
      )
      expect([...output.matchAll(SEQUENCE)]).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})

describe('the zsh hook, as text', () => {
  it('puts the zsh hook beside the bash one', () => {
    expect(shellIntegrationFileZsh({ HOME: '/home/u' })).toBe('/home/u/.config/termspace/shell-integration.zsh')
  })

  it('zsh hook reports the submitted line and the cwd', () => {
    expect(HOOK_SCRIPT_ZSH).toContain('add-zsh-hook preexec')
    expect(HOOK_SCRIPT_ZSH).toContain('1173;C')
    expect(HOOK_SCRIPT_ZSH).toContain(']7;')
    expect(HOOK_SCRIPT_ZSH).toContain('TERM_PROGRAM')
  })

  it('zsh rc line sources the zsh file', () => {
    expect(RC_LINE_ZSH).toContain('shell-integration.zsh')
  })
})

/**
 * Run one interactive zsh under a pty and read back both what the hook sent and
 * what the OSC 7 it emitted means to the parser that actually consumes it —
 * the escaping in the hook is only correct relative to `parseCwd`.
 */
async function runHookedZsh(dir: string, lines: readonly string[]): Promise<Session & { cwds: string[] }> {
  writeFileSync(join(dir, '.zshrc'), [`. ${join(dir, 'hook.zsh')}`, ''].join('\n'))
  writeFileSync(join(dir, 'hook.zsh'), HOOK_SCRIPT_ZSH)

  const output = await runShell('zsh', ['-i'], { TERM_PROGRAM: 'Termspace', ZDOTDIR: dir }, lines)

  let sourced = false
  const commands: string[] = []
  for (const match of output.matchAll(SEQUENCE)) {
    const body = match[1] ?? ''
    if (body === 'A') sourced = true
    else if (body.startsWith('C;')) commands.push(Buffer.from(body.slice(2), 'base64').toString('utf8'))
  }

  const cwds = scanTerminalSignals(NO_SIGNALS, output)
    .signals.filter((signal) => signal.kind === 'cwd')
    .map((signal) => signal.path)

  return { sourced, commands, output, cwds }
}

describe.skipIf(!hasZsh)('the zsh hook, on a real zsh', () => {
  it('reports each submitted line once, by the name that was typed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'termspace-hook-'))
    try {
      const session = await runHookedZsh(dir, ["alias compound='echo one && echo two'", 'compound', 'echo done'])
      expect(session.sourced).toBe(true)
      expect(session.commands).toEqual(["alias compound='echo one && echo two'", 'compound', 'echo done', 'exit'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('reports a cwd the parser reads back byte for byte, spaces and percents included', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'termspace-hook-'))
    try {
      const awkward = join(dir, 'a b%c')
      mkdirSync(awkward)
      const session = await runHookedZsh(dir, [`cd '${awkward}'`])
      expect(session.cwds).toContain(awkward)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('stays silent outside Termspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'termspace-hook-'))
    try {
      writeFileSync(join(dir, '.zshrc'), [`. ${join(dir, 'hook.zsh')}`, ''].join('\n'))
      writeFileSync(join(dir, 'hook.zsh'), HOOK_SCRIPT_ZSH)
      const output = await runShell('zsh', ['-i'], { TERM_PROGRAM: 'SomeOtherTerminal', ZDOTDIR: dir }, ['echo hello'])
      expect([...output.matchAll(SEQUENCE)]).toEqual([])
      expect(scanTerminalSignals(NO_SIGNALS, output).signals.filter((s) => s.kind === 'cwd')).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
