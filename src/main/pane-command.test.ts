import { describe, expect, it } from 'vitest'
import { resolvePaneCommand } from './pane-command'

const IDLE = {
  prefill: null,
  declaredCommand: null,
  submittedCommand: null,
  foregroundCommand: null,
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
})
