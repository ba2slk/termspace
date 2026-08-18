/**
 * Asks GitHub whether a newer release exists, at startup and once a day.
 *
 * `fetch` and the setting come in from outside so the whole thing runs under a
 * unit test; the decision itself is in update-check. Nothing is downloaded and
 * nothing is retried — the next check is at most a day away.
 */
import type { UpdateState } from '../shared/protocol'
import { pickUpdate } from './update-check'

export const RELEASES_API = 'https://api.github.com/repos/ba2slk/termspace/releases?per_page=20'
export const RELEASES_PAGE = 'https://github.com/ba2slk/termspace/releases'

const DAY_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 10_000

export interface UpdaterOptions {
  readonly currentVersion: string
  readonly fetch: typeof globalThis.fetch
  /** Whether the automatic checks are on; read at each tick, not once. */
  readonly automatic: () => Promise<boolean>
  /** Called after a background check that found something to say. */
  readonly onState: (state: UpdateState) => void
  readonly intervalMs?: number
}

export interface Updater {
  /** A check the user asked for. Always runs; resolves to what it found. */
  checkNow(): Promise<UpdateState>
  /** The offered release's page, or the releases index. */
  releaseUrl(): string
  /** Startup check plus the timer. */
  start(): void
  stop(): void
}

export function createUpdater(options: UpdaterOptions): Updater {
  const interval = options.intervalMs ?? DAY_MS
  let offeredUrl: string | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  async function check(): Promise<UpdateState> {
    let payload: unknown
    try {
      const response = await options.fetch(RELEASES_API, {
        headers: {
          accept: 'application/vnd.github+json',
          // GitHub refuses requests without one.
          'user-agent': `Termspace/${options.currentVersion}`,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) return { kind: 'failed' }
      payload = await response.json()
    } catch {
      return { kind: 'failed' }
    }
    const picked = pickUpdate(payload, options.currentVersion)
    if (picked === null) {
      offeredUrl = null
      return { kind: 'up-to-date' }
    }
    offeredUrl = picked.url
    return { kind: 'available', version: picked.version }
  }

  async function tick(): Promise<void> {
    if (!(await options.automatic())) return
    const state = await check()
    if (state.kind === 'available') options.onState(state)
  }

  return {
    checkNow: check,
    releaseUrl: () => offeredUrl ?? RELEASES_PAGE,
    start() {
      if (timer !== null) return
      void tick()
      timer = setInterval(() => void tick(), interval)
    },
    stop() {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },
  }
}
