import { describe, expect, it } from 'vitest'
import { resolvePaneCommand } from './pane-command'

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
