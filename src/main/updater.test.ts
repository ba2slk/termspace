import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUpdater, RELEASES_PAGE, type Updater } from './updater'
import type { UpdateState } from '../shared/protocol'

const releases = (...tags: string[]) =>
  tags.map((tag) => ({
    tag_name: tag,
    html_url: `https://github.com/ba2slk/termspace/releases/tag/${tag}`,
    draft: false,
    prerelease: tag.includes('-'),
  }))

const ok = (body: unknown): typeof fetch => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
const down: typeof fetch = vi.fn(async () => { throw new TypeError('fetch failed') })

let states: UpdateState[]
let updater: Updater | null

function make(fetchImpl: typeof fetch, automatic = true, version = '1.0.0'): Updater {
  states = []
  updater = createUpdater({
    currentVersion: version,
    fetch: fetchImpl,
    automatic: async () => automatic,
    onState: (s) => states.push(s),
    intervalMs: 1000,
  })
  return updater
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  updater?.stop()
  updater = null
  vi.useRealTimers()
})

describe('checkNow', () => {
  it('reports the newer release and remembers its page', async () => {
    const u = make(ok(releases('v1.0.0', 'v1.2.0')))
    await expect(u.checkNow()).resolves.toEqual({ kind: 'available', version: '1.2.0' })
    expect(u.releaseUrl()).toBe('https://github.com/ba2slk/termspace/releases/tag/v1.2.0')
  })

  it('reports up to date when nothing is newer, and points at the releases index', async () => {
    const u = make(ok(releases('v1.0.0')))
    await expect(u.checkNow()).resolves.toEqual({ kind: 'up-to-date' })
    expect(u.releaseUrl()).toBe(RELEASES_PAGE)
  })

  it('reports failure when GitHub is unreachable or answers oddly', async () => {
    await expect(make(down).checkNow()).resolves.toEqual({ kind: 'failed' })
    const notOk: typeof fetch = vi.fn(async () => new Response('{}', { status: 403 }))
    await expect(make(notOk).checkNow()).resolves.toEqual({ kind: 'failed' })
    const notJson: typeof fetch = vi.fn(async () => new Response('<html>', { status: 200 }))
    await expect(make(notJson).checkNow()).resolves.toEqual({ kind: 'failed' })
  })

  it('runs even when the automatic check is off', async () => {
    const u = make(ok(releases('v1.2.0')), false)
    await expect(u.checkNow()).resolves.toEqual({ kind: 'available', version: '1.2.0' })
  })

  it('sends the request with a User-Agent and the GitHub accept header', async () => {
    const f = ok(releases('v1.0.0'))
    await make(f).checkNow()
    const init = (f as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get('user-agent')).toMatch(/^Termspace\/1\.0\.0/)
    expect(headers.get('accept')).toContain('application/vnd.github')
  })
})

describe('start', () => {
  it('checks at once and pushes only when something is available', async () => {
    const f = ok(releases('v1.2.0'))
    make(f).start()
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
    expect(states).toEqual([{ kind: 'available', version: '1.2.0' }])
  })

  it('says nothing for a background check that finds nothing or fails', async () => {
    make(ok(releases('v1.0.0'))).start()
    await vi.advanceTimersByTimeAsync(0)
    expect(states).toEqual([])
    updater?.stop()
    make(down).start()
    await vi.advanceTimersByTimeAsync(0)
    expect(states).toEqual([])
  })

  it('checks again every interval, and stops when told', async () => {
    const f = ok(releases('v1.0.0'))
    const u = make(f)
    u.start()
    await vi.advanceTimersByTimeAsync(2500)
    expect(f).toHaveBeenCalledTimes(3)
    u.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('skips the automatic check while the setting is off', async () => {
    const f = ok(releases('v1.2.0'))
    make(f, false).start()
    await vi.advanceTimersByTimeAsync(2500)
    expect(f).not.toHaveBeenCalled()
    expect(states).toEqual([])
  })
})
