import { describe, expect, it } from 'vitest'
import {
  foregroundFrom,
  herdrAttachCommand,
  herdrError,
  herdrSessionFromCommand,
  isHerdrName,
  nextHerdrName,
  paneIdsFrom,
  sessionNamesFrom,
  sessionStem,
} from './herdr-command'

describe('herdrSessionFromCommand', () => {
  it('reads --session', () => {
    expect(herdrSessionFromCommand('herdr --session termspace-1')).toBe('termspace-1')
  })
  it('reads session attach', () => {
    expect(herdrSessionFromCommand('herdr session attach portfolio')).toBe('portfolio')
  })
  it('bare herdr is the default session', () => {
    expect(herdrSessionFromCommand('herdr')).toBe('default')
    expect(herdrSessionFromCommand('  herdr  ')).toBe('default')
  })
  it('ignores other herdr subcommands', () => {
    expect(herdrSessionFromCommand('herdr session list')).toBeNull()
    expect(herdrSessionFromCommand('herdr session stop x')).toBeNull()
    expect(herdrSessionFromCommand('herdr --version')).toBeNull()
  })
  it('ignores other programs and a path that merely contains herdr', () => {
    expect(herdrSessionFromCommand('claude')).toBeNull()
    expect(herdrSessionFromCommand('vim herdr.toml')).toBeNull()
    expect(herdrSessionFromCommand('')).toBeNull()
  })
  it('accepts an absolute herdr binary, as /proc reports it', () => {
    expect(herdrSessionFromCommand('/home/u/.local/bin/herdr --session a.b_c')).toBe('a.b_c')
  })
  it('rejects a name herdr would reject', () => {
    expect(herdrSessionFromCommand('herdr --session "no such"')).toBeNull()
  })
})

describe('isHerdrName', () => {
  it('accepts what herdr accepts', () => {
    expect(isHerdrName('a.b_c-1')).toBe(true)
    expect(isHerdrName('no such')).toBe(false)
    expect(isHerdrName('')).toBe(false)
    expect(isHerdrName('한글')).toBe(false)
  })
})

describe('herdrAttachCommand', () => {
  it('is the --session form', () => {
    expect(herdrAttachCommand('termspace-2')).toBe('herdr --session termspace-2')
  })
  it('round-trips through the parser', () => {
    expect(herdrSessionFromCommand(herdrAttachCommand('default'))).toBe('default')
  })
})

describe('sessionStem', () => {
  it('lowers and keeps herdr-legal characters', () => {
    expect(sessionStem('Termspace')).toBe('termspace')
    expect(sessionStem('cat.ch_up-1')).toBe('cat.ch_up-1')
  })
  it('replaces what herdr rejects and collapses runs', () => {
    expect(sessionStem('My Project')).toBe('my-project')
    expect(sessionStem('a  /  b')).toBe('a-b')
  })
  it('falls back when nothing legal is left', () => {
    expect(sessionStem('내 작업')).toBe('termspace')
    expect(sessionStem('')).toBe('termspace')
    expect(sessionStem(null)).toBe('termspace')
  })
  it('never starts or ends with a dash', () => {
    expect(sessionStem('-x-')).toBe('x')
  })
})

describe('nextHerdrName', () => {
  it('starts at 1', () => {
    expect(nextHerdrName('termspace', [])).toBe('termspace-1')
  })
  it('skips taken numbers, including stopped sessions', () => {
    expect(nextHerdrName('termspace', ['termspace-1', 'termspace-2', 'other'])).toBe('termspace-3')
  })
  it('fills the first gap', () => {
    expect(nextHerdrName('termspace', ['termspace-2'])).toBe('termspace-1')
  })
})

const LIST = {
  sessions: [
    { default: true, name: 'default', running: false },
    { default: false, name: 'termspace-1', running: true },
    { default: false, name: 'blackbox', running: false },
  ],
}

const SNAPSHOT = {
  id: 'cli:api:snapshot',
  result: {
    snapshot: {
      panes: [
        { pane_id: 'w1:p1', tab_id: 'w1:t1', agent: 'claude' },
        { pane_id: 'w1:p2', tab_id: 'w1:t2', agent: null },
      ],
    },
  },
}

const info = (processes: readonly { name: string; cmdline: string; argv?: readonly string[] }[]) => ({
  id: 'cli:pane:process_info',
  result: {
    process_info: {
      pane_id: 'w1:p1',
      shell_pid: 1,
      foreground_processes: processes.map((p) => ({ argv: p.cmdline.split(' '), ...p })),
    },
  },
})

describe('sessionNamesFrom', () => {
  it('lists every name, running or stopped', () => {
    expect(sessionNamesFrom(LIST)).toEqual(['default', 'termspace-1', 'blackbox'])
  })
  it('is empty for anything else', () => {
    expect(sessionNamesFrom(null)).toEqual([])
    expect(sessionNamesFrom({ error: { code: 'x', message: 'y' } })).toEqual([])
  })
})

describe('paneIdsFrom', () => {
  it('reads the pane ids', () => {
    expect(paneIdsFrom(SNAPSHOT)).toEqual(['w1:p1', 'w1:p2'])
  })
  it('is empty for a server with no workspace yet, or an error', () => {
    expect(paneIdsFrom({ id: 'x', result: { snapshot: { panes: [] } } })).toEqual([])
    expect(paneIdsFrom({ id: 'x', error: { code: 'server_not_running', message: '' } })).toEqual([])
  })
})

describe('foregroundFrom', () => {
  it('names the program', () => {
    expect(foregroundFrom(info([{ name: 'claude', cmdline: 'claude --resume' }]))).toBe('claude --resume')
  })
  it('is null for a login shell alone', () => {
    for (const shell of ['bash', 'zsh', 'fish', 'sh', 'dash']) {
      expect(foregroundFrom(info([{ name: shell, cmdline: shell }]))).toBeNull()
    }
  })
  it('a shell running a script is busy', () => {
    expect(foregroundFrom(info([{ name: 'bash', cmdline: 'bash deploy.sh' }]))).toBe('bash deploy.sh')
    expect(foregroundFrom(info([{ name: 'zsh', cmdline: 'zsh menu.sh' }]))).toBe('zsh menu.sh')
    expect(foregroundFrom(info([{ name: 'sh', cmdline: "sh -c 'x'", argv: ['sh', '-c', 'x'] }]))).toBe("sh -c 'x'")
  })
  it('a shell with only flags is idle', () => {
    expect(foregroundFrom(info([{ name: 'zsh', cmdline: 'zsh -il' }]))).toBeNull()
    expect(foregroundFrom(info([{ name: 'bash', cmdline: '-bash', argv: ['-bash'] }]))).toBeNull()
  })
  it('falls back to the name when argv is missing', () => {
    const raw = { result: { process_info: { foreground_processes: [{ name: 'bash', cmdline: 'bash deploy.sh' }] } } }
    expect(foregroundFrom(raw)).toBeNull()
  })
  it('is null when nothing is in the foreground', () => {
    expect(foregroundFrom(info([]))).toBeNull()
  })
  it('is the first program when a pipeline runs', () => {
    expect(
      foregroundFrom(info([{ name: 'tail', cmdline: 'tail -f x' }, { name: 'grep', cmdline: 'grep y' }])),
    ).toBe('tail -f x')
  })
  it('is null for malformed input', () => {
    expect(foregroundFrom(undefined)).toBeNull()
  })
})

describe('herdrError', () => {
  it('reads a top-level error', () => {
    expect(herdrError({ error: { code: 'session_stop_failed', message: 'm' } })).toEqual({
      code: 'session_stop_failed',
      message: 'm',
    })
  })
  it('reads an error beside an id', () => {
    expect(herdrError({ id: 'cli:api:snapshot', error: { code: 'server_not_running', message: 'm' } })?.code).toBe(
      'server_not_running',
    )
  })
  it('is null for a result', () => {
    expect(herdrError(SNAPSHOT)).toBeNull()
    expect(herdrError('not json')).toBeNull()
  })
})
