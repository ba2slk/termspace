import { execFileSync } from 'node:child_process'
import { spawn } from 'node-pty'
import { describe, expect, it } from 'vitest'
import { createPtyHost, cwdViaLsof, foregroundCommandViaPs } from './pty-host'

/*
 * The ps path is what mac uses instead of /proc, and no mac runs this suite
 * during development. GNU ps answers tpgid and args the same way BSD ps does,
 * so the path can be driven for real here: a shell on a pty, a job started in
 * it, and the command read back out.
 */

const hasPs = ((): boolean => {
  try {
    execFileSync('ps', ['-o', 'tpgid=', '-p', String(process.pid)], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const hasBash = ((): boolean => {
  try {
    execFileSync('sh', ['-c', 'command -v bash'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const hasLsof = ((): boolean => {
  try {
    execFileSync('lsof', ['-a', '-d', 'cwd', '-p', String(process.pid), '-Fn'], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
})()

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Poll rather than wait a fixed time: spawning a job is slower on a loaded machine. */
async function waitFor(read: () => Promise<string | null>): Promise<string | null> {
  for (let i = 0; i < 100; i++) {
    const value = await read()
    if (value !== null) return value
    await sleep(100)
  }
  return null
}

describe.skipIf(!hasPs || !hasBash)('the foreground command through ps', () => {
  it('is null while the shell waits, and the job once one runs', async () => {
    const term = spawn('bash', ['--norc', '-i'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      env: { ...process.env, TERM: 'xterm-256color' },
    })
    try {
      // An interactive bash puts itself in the foreground, which reads as idle.
      await sleep(500)
      expect(await foregroundCommandViaPs(term.pid)).toBe(null)

      term.write('sleep 300\r')
      const running = await waitFor(() => foregroundCommandViaPs(term.pid))
      expect(running).toMatch(/sleep 300$/)
    } finally {
      term.kill()
    }
  }, 20_000)
})

describe('createPtyHost spawn', () => {
  it('fails when cwd does not exist', () => {
    const host = createPtyHost()
    const result = host.spawn(
      {
        paneId: 'test-pane-1',
        cwd: '/path/does/not/exist/surely/12345',
        shell: '/bin/sh',
        command: null,
        prefill: null,
        cols: 80,
        rows: 24,
      },
      {
        onData: () => {},
        onExit: () => {},
        onAttention: () => {},
      },
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Directory does not exist')
    expect(result.message).toContain('/path/does/not/exist/surely/12345')
  })

  it('reads cwd of spawned process', async () => {
    const host = createPtyHost()
    const result = host.spawn(
      {
        paneId: 'test-cwd-pane',
        cwd: process.cwd(),
        shell: '/bin/sh',
        command: null,
        prefill: null,
        cols: 80,
        rows: 24,
      },
      {
        onData: () => {},
        onExit: () => {},
        onAttention: () => {},
      },
    )

    expect(result.ok).toBe(true)
    expect(host.cwdOf('test-cwd-pane')).toBe(process.cwd())
    host.kill('test-cwd-pane')
  })
})

describe.skipIf(!hasLsof)('cwdViaLsof', () => {
  it('reads process cwd', () => {
    expect(cwdViaLsof(process.pid)).toBe(process.cwd())
  })
})
