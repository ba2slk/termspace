import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOOK_SCRIPT } from './shell-integration'

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
 */

const hasScript = ((): boolean => {
  try {
    execFileSync('sh', ['-c', 'command -v script'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/*
 * `script` takes its command differently on each platform: util-linux wants one
 * string after -c, BSD (macOS) takes the argv after the typescript file and has
 * no -c at all.
 */
function scriptArgs(argv: readonly string[]): string[] {
  return platform() === 'darwin'
    ? ['-q', '/dev/null', ...argv]
    : ['-qec', argv.join(' '), '/dev/null']
}

const PRIOR = 'PRIOR_COMMAND_FROM_ANOTHER_SHELL'
const SEQUENCE = /\u001b\]1173;([^\u0007]*)\u0007/g

interface Session {
  readonly sourced: boolean
  readonly commands: readonly string[]
  readonly output: string
}

/** Run one interactive bash under a pty, feed it lines, read back what the hook sent. */
function runHookedShell(lines: readonly string[]): Session {
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

    const output = execFileSync(
      'script',
      scriptArgs(['bash', '--rcfile', join(dir, 'rc'), '-i']),
      {
        input: `${[...lines, 'exit'].join('\n')}\n`,
        env: { ...process.env, TERM_PROGRAM: 'Termspace', TERM: 'xterm-256color' },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )

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

describe.skipIf(!hasScript)('the bash hook', () => {
  it('reports each submitted line once, and nothing it was not given', () => {
    const session = runHookedShell(['echo hello', 'compound', 'echo done'])

    expect(session.sourced).toBe(true)
    // 'compound' once rather than once per component, and by name, not by body.
    expect(session.commands).toEqual(['echo hello', 'compound', 'echo done', 'exit'])
  })

  it('never reports a command another shell left in the shared history', () => {
    expect(runHookedShell(['echo hello']).commands).not.toContain(PRIOR)
  })

  it('leaves the exit status of the previous command alone', () => {
    // The trap runs before every command, and a careless one clobbers $?.
    const session = runHookedShell(['false', 'echo status=$?'])
    expect(session.output).toContain('status=1')
  })

  it('stays silent outside Termspace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'termspace-hook-'))
    try {
      writeFileSync(join(dir, 'hook.bash'), HOOK_SCRIPT)
      const output = execFileSync(
        'script',
        scriptArgs(['bash', '--rcfile', join(dir, 'hook.bash'), '-i']),
        {
          input: 'echo hello\nexit\n',
          env: { ...process.env, TERM_PROGRAM: 'SomeOtherTerminal', TERM: 'xterm-256color' },
          encoding: 'utf8',
          timeout: 20_000,
        },
      )
      expect([...output.matchAll(SEQUENCE)]).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
