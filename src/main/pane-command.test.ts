import { describe, expect, it } from 'vitest'
import { attachedHerdr, resolvePaneCommand, resolveSavedPane } from './pane-command'

const IDLE = {
  prefill: null,
  declaredCommand: null,
  submittedCommand: null,
  foregroundCommand: null,
  declaredCwd: '/home/u/work',
  liveCwd: '/home/u/work',
  home: '/home/u',
}

describe('resolvePaneCommand', () => {
  it('keeps the declared command when a prefill says not to run', () => {
    expect(
      resolvePaneCommand({
        ...IDLE,
        prefill: 'cu down full',
        declaredCommand: 'npm run dev',
        submittedCommand: 'cu down full',
        foregroundCommand: 'node /usr/bin/cu down full',
      }),
    ).toBe('npm run dev')
  })

  it('prefers what the shell reported over what /proc saw', () => {
    expect(
      resolvePaneCommand({
        ...IDLE,
        declaredCommand: 'old',
        submittedCommand: 'qatn',
        foregroundCommand: "ssh -i /home/me/k.pem -L 0.0.0.0:5432:db:5432 -N ubuntu@1.2.3.4",
      }),
    ).toBe('qatn')
  })

  it('falls back to /proc when no shell integration is present', () => {
    expect(
      resolvePaneCommand({ ...IDLE, declaredCommand: 'old', foregroundCommand: 'htop' }),
    ).toBe('htop')
  })

  it('keeps the declared command while the shell sits idle', () => {
    // The pane's purpose survives a moment when nothing happens to be running.
    expect(
      resolvePaneCommand({ ...IDLE, declaredCommand: 'npm run dev', submittedCommand: 'ls' }),
    ).toBe('npm run dev')
  })

  it('leaves a pane that never had a command empty', () => {
    expect(resolvePaneCommand(IDLE)).toBeNull()
  })

  it('drops the declared command once an idle pane has been cd-ed away', () => {
    // The job ended and the user moved on: command and cwd would be a pairing
    // that never ran.
    expect(
      resolvePaneCommand({
        ...IDLE,
        declaredCommand: './tmux-catchup.sh',
        declaredCwd: '~',
        liveCwd: '/home/u/work',
      }),
    ).toBeNull()
  })

  it('reads `~` and the home path as the same place', () => {
    expect(
      resolvePaneCommand({
        ...IDLE,
        declaredCommand: './tmux-catchup.sh',
        declaredCwd: '~',
        liveCwd: '/home/u',
      }),
    ).toBe('./tmux-catchup.sh')
  })

  it('keeps the declared command when the pty is gone and the cwd is unknown', () => {
    expect(
      resolvePaneCommand({ ...IDLE, declaredCommand: 'npm run dev', liveCwd: null }),
    ).toBe('npm run dev')
  })

  it('keeps a prefill pane whole even after a cd', () => {
    expect(
      resolvePaneCommand({
        ...IDLE,
        prefill: 'cu down full',
        declaredCommand: 'npm run dev',
        liveCwd: '/home/u/elsewhere',
      }),
    ).toBe('npm run dev')
  })

  it('captures what runs now even after a cd', () => {
    expect(
      resolvePaneCommand({
        ...IDLE,
        declaredCommand: 'old',
        submittedCommand: 'htop',
        foregroundCommand: 'htop',
        liveCwd: '/home/u/elsewhere',
      }),
    ).toBe('htop')
  })
})

const SAVED = { ...IDLE, declaredHerdr: null, inside: null }

describe('attachedHerdr', () => {
  it('reads the shell line first', () => {
    expect(attachedHerdr({ ...IDLE, submittedCommand: 'herdr --session a', foregroundCommand: '/home/u/.local/bin/herdr --session a' })).toBe('a')
  })
  it('falls back to /proc', () => {
    expect(attachedHerdr({ ...IDLE, foregroundCommand: '/home/u/.local/bin/herdr --session b' })).toBe('b')
  })
  it('is null for an idle shell or another program', () => {
    expect(attachedHerdr(IDLE)).toBeNull()
    expect(attachedHerdr({ ...IDLE, foregroundCommand: 'htop' })).toBeNull()
  })
  it('is null once the shell is idle, whatever it last submitted', () => {
    expect(attachedHerdr({ ...IDLE, submittedCommand: 'herdr --session a' })).toBeNull()
  })
  it('sees through an alias by falling back to /proc', () => {
    expect(attachedHerdr({ ...IDLE, submittedCommand: 'h', foregroundCommand: '/home/u/.local/bin/herdr --session a' })).toBe('a')
  })
})

describe('resolveSavedPane', () => {
  const attached = { ...SAVED, submittedCommand: 'herdr --session a', foregroundCommand: 'herdr --session a' }

  it('writes the inner program as the command', () => {
    expect(resolveSavedPane({ ...attached, inside: { panes: 1, foreground: 'claude --resume' } })).toEqual({
      command: 'claude --resume',
      herdr: 'a',
    })
  })
  it('keeps the declared command when the inner shell is idle', () => {
    expect(resolveSavedPane({ ...attached, declaredCommand: 'claude', inside: { panes: 1, foreground: null } })).toEqual({
      command: 'claude',
      herdr: 'a',
    })
  })
  it('keeps the declared command while the server is still starting', () => {
    expect(resolveSavedPane({ ...attached, declaredCommand: 'claude', inside: { panes: 0, foreground: null } })).toEqual({
      command: 'claude',
      herdr: 'a',
    })
  })
  it('keeps the declared command when herdr holds several panes', () => {
    expect(resolveSavedPane({ ...attached, declaredCommand: 'claude', inside: { panes: 2, foreground: null } })).toEqual({
      command: 'claude',
      herdr: 'a',
    })
  })
  it('keeps the declared command when the server does not answer', () => {
    expect(resolveSavedPane({ ...attached, declaredCommand: 'claude', inside: null })).toEqual({ command: 'claude', herdr: 'a' })
  })
  it('a hand-typed attach saves like a declared one', () => {
    expect(resolveSavedPane({ ...attached, declaredHerdr: null, inside: { panes: 1, foreground: 'claude' } })).toEqual({
      command: 'claude',
      herdr: 'a',
    })
  })
  it('an idle outer shell keeps both declared fields', () => {
    expect(resolveSavedPane({ ...SAVED, declaredCommand: 'claude', declaredHerdr: 'a' })).toEqual({ command: 'claude', herdr: 'a' })
  })
  it('an idle shell after leaving herdr keeps the declared fields', () => {
    expect(
      resolveSavedPane({ ...SAVED, declaredCommand: 'claude', declaredHerdr: 'a', submittedCommand: 'herdr --session a' }),
    ).toEqual({ command: 'claude', herdr: 'a' })
    expect(resolveSavedPane({ ...SAVED, declaredCommand: 'claude', submittedCommand: 'herdr --session a' })).toEqual({
      command: 'claude',
      herdr: null,
    })
  })
  it('an idle outer shell that moved away drops both', () => {
    expect(resolveSavedPane({ ...SAVED, declaredCommand: 'claude', declaredHerdr: 'a', liveCwd: '/tmp' })).toEqual({
      command: null,
      herdr: null,
    })
  })
  it('another program in the outer shell drops herdr', () => {
    expect(resolveSavedPane({ ...SAVED, declaredHerdr: 'a', foregroundCommand: 'htop' })).toEqual({ command: 'htop', herdr: null })
  })
  it('a prefill still wins', () => {
    expect(resolveSavedPane({ ...SAVED, prefill: 'x', declaredCommand: 'y', foregroundCommand: 'z' })).toEqual({ command: 'y', herdr: null })
  })
})
