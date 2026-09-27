import { describe, expect, it } from 'vitest'
import type { HerdrCli, HerdrReply } from './herdr-cli'
import { insideHerdr, startInsideHerdr } from './herdr-attach'

const notRunning: HerdrReply = { ok: false, code: 'server_not_running', message: 'no herdr server' }
const snapshot = (ids: readonly string[]): HerdrReply => ({
  ok: true,
  json: { result: { snapshot: { panes: ids.map((pane_id) => ({ pane_id })) } } },
})
const processInfo = (name: string): HerdrReply => ({
  ok: true,
  json: { result: { process_info: { foreground_processes: name === '' ? [] : [{ name, cmdline: name }] } } },
})
const done: HerdrReply = { ok: true, json: { result: {} } }

/** A scripted herdr: snapshot answers in order, process-info fixed, calls recorded. */
function fake(snapshots: readonly HerdrReply[], foreground: string) {
  const calls: { session: string | null; args: readonly string[] }[] = []
  let i = 0
  const cli: HerdrCli = async (session, args) => {
    calls.push({ session, args })
    if (args[0] === 'api') return snapshots[Math.min(i++, snapshots.length - 1)]!
    if (args[0] === 'pane' && args[1] === 'process-info') return processInfo(foreground)
    if (args[0] === 'pane' && args[1] === 'run') return done
    throw new Error(`unexpected ${args.join(' ')}`)
  }
  return { cli, calls }
}

const fast = { timeoutMs: 50, intervalMs: 1, sleep: async () => {} }

describe('insideHerdr', () => {
  it('is null when the server does not answer', async () => {
    expect(await insideHerdr(fake([notRunning], '').cli, 'x')).toBeNull()
  })
  it('reports one idle pane', async () => {
    expect(await insideHerdr(fake([snapshot(['w1:p1'])], 'zsh').cli, 'x')).toEqual({ panes: 1, foreground: null })
  })
  it('reports one busy pane with its command', async () => {
    expect(await insideHerdr(fake([snapshot(['w1:p1'])], 'claude').cli, 'x')).toEqual({ panes: 1, foreground: 'claude' })
  })
  it('does not read process info when there are several panes', async () => {
    const f = fake([snapshot(['w1:p1', 'w1:p2'])], 'claude')
    expect(await insideHerdr(f.cli, 'x')).toEqual({ panes: 2, foreground: null })
    expect(f.calls.some((c) => c.args[1] === 'process-info')).toBe(false)
  })
})

describe('startInsideHerdr', () => {
  it('waits for the server, then for its first pane, then runs the command as one argument', async () => {
    const f = fake([notRunning, snapshot([]), snapshot(['w1:p1'])], 'bash')
    expect(await startInsideHerdr(f.cli, 'x', 'claude --resume', fast)).toBe('ran')
    const run = f.calls.find((c) => c.args[1] === 'run')
    expect(run).toEqual({ session: 'x', args: ['pane', 'run', 'w1:p1', 'claude --resume'] })
  })
  it('leaves a busy pane alone', async () => {
    const f = fake([snapshot(['w1:p1'])], 'claude')
    expect(await startInsideHerdr(f.cli, 'x', 'claude', fast)).toBe('busy')
    expect(f.calls.some((c) => c.args[1] === 'run')).toBe(false)
  })
  it('leaves a session with several panes alone', async () => {
    const f = fake([snapshot(['w1:p1', 'w1:p2'])], 'bash')
    expect(await startInsideHerdr(f.cli, 'x', 'claude', fast)).toBe('many-panes')
  })
  it('gives up when the server never answers', async () => {
    expect(await startInsideHerdr(fake([notRunning], 'bash').cli, 'x', 'claude', fast)).toBe('timeout')
  })
  it('stops polling once the pane is gone', async () => {
    const f = fake([notRunning, snapshot(['w1:p1'])], 'bash')
    const answers = [true, false]
    const alive = () => answers.shift() ?? false
    expect(await startInsideHerdr(f.cli, 'x', 'claude', { ...fast, alive })).toBe('cancelled')
    expect(f.calls.some((c) => c.args[1] === 'run')).toBe(false)
  })
  it('does not run into a pane closed while it looked', async () => {
    const f = fake([snapshot(['w1:p1'])], 'bash')
    const answers = [true, false]
    const alive = () => answers.shift() ?? false
    expect(await startInsideHerdr(f.cli, 'x', 'claude', { ...fast, alive })).toBe('cancelled')
    expect(f.calls.some((c) => c.args[1] === 'run')).toBe(false)
  })
  it('gives up at once on any other error', async () => {
    const f = fake([{ ok: false, code: 'unknown', message: 'boom' }], 'bash')
    expect(await startInsideHerdr(f.cli, 'x', 'claude', fast)).toBe('failed')
    expect(f.calls.filter((c) => c.args[0] === 'api').length).toBe(1)
  })
})
