/**
 * What runs inside a herdr session, and starting the program there once.
 *
 * herdr restores a session's tabs but not what ran in them, so a restore has
 * to put the program back. Only when the session is a single bare shell: more
 * panes means the user shaped it, a busy pane means something already runs.
 */
import { foregroundFrom, paneIdsFrom } from './herdr-command'
import type { HerdrCli } from './herdr-cli'

export interface HerdrInside {
  readonly panes: number
  /** The single pane's foreground; null when idle or when panes !== 1. */
  readonly foreground: string | null
}

type Look =
  | { readonly kind: 'inside'; readonly inside: HerdrInside; readonly paneId: string | null }
  | { readonly kind: 'not-running' }
  | { readonly kind: 'failed' }

async function look(cli: HerdrCli, name: string): Promise<Look> {
  const reply = await cli(name, ['api', 'snapshot'])
  if (!reply.ok) return reply.code === 'server_not_running' ? { kind: 'not-running' } : { kind: 'failed' }
  const ids = paneIdsFrom(reply.json)
  if (ids.length !== 1) return { kind: 'inside', inside: { panes: ids.length, foreground: null }, paneId: null }
  const paneId = ids[0]!
  const info = await cli(name, ['pane', 'process-info', '--pane', paneId])
  if (!info.ok) return { kind: 'failed' }
  return { kind: 'inside', inside: { panes: 1, foreground: foregroundFrom(info.json) }, paneId }
}

/** What runs inside a session, or null when the server does not answer. */
export async function insideHerdr(cli: HerdrCli, name: string): Promise<HerdrInside | null> {
  const seen = await look(cli, name)
  return seen.kind === 'inside' ? seen.inside : null
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Run `command` in the session's only pane once it is a bare shell.
 * Resolves to what it did; never throws. `alive` going false (the Termspace
 * pane was closed) resolves `'cancelled'` without running anything.
 */
export async function startInsideHerdr(
  cli: HerdrCli,
  name: string,
  command: string,
  options: {
    readonly timeoutMs?: number
    readonly intervalMs?: number
    readonly sleep?: (ms: number) => Promise<void>
    readonly alive?: () => boolean
  } = {},
): Promise<'ran' | 'busy' | 'many-panes' | 'timeout' | 'failed' | 'cancelled'> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const intervalMs = options.intervalMs ?? 200
  const sleep = options.sleep ?? defaultSleep
  const alive = options.alive ?? (() => true)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (!alive()) return 'cancelled'
    const seen = await look(cli, name)
    if (seen.kind === 'failed') return 'failed'
    if (seen.kind === 'inside' && seen.inside.panes > 1) return 'many-panes'
    if (seen.kind === 'inside' && seen.paneId !== null) {
      if (seen.inside.foreground !== null) return 'busy'
      // The look above awaited; the pane may have closed meanwhile.
      if (!alive()) return 'cancelled'
      // One argument: herdr joins the trailing words itself, and a program
      // with flags must arrive as the line the user would have typed.
      const ran = await cli(name, ['pane', 'run', seen.paneId, command])
      return ran.ok ? 'ran' : 'failed'
    }
    // Not running yet, or running with no workspace yet: both are "wait".
    if (Date.now() >= deadline) return 'timeout'
    await sleep(intervalMs)
  }
}
