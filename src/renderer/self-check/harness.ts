/**
 * Shared plumbing for the self-check groups.
 *
 * The checks themselves live in `core`, `motion`, `chrome` and `sessions`; this
 * is what all of them need — waiting, key synthesis, DOM lookups, screenshots.
 */
import { api } from '../api'

export type Report = Record<string, string>

export const FAIL_PATTERN = /FAIL|MISMATCH|NONE|LEAKED|COLLISION|GONE/

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Wait for a condition instead of guessing a duration.
 *
 * A fixed sleep is a bet on how long a machine takes. Splitting a pane spawns a
 * shell, and with several groups running side by side that can outlast any
 * number picked while idle — the check then reports a failure that is really a
 * slow machine.
 */
export async function waitFor(done: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const until = performance.now() + timeoutMs
  while (performance.now() < until) {
    if (done()) return true
    await sleep(50)
  }
  return done()
}

/** Shortcuts match on `code`, but dialogs listen on `key`, so fill in both. */
export const KEY_OF_CODE: Readonly<Record<string, string>> = {
  Escape: 'Escape',
  Enter: 'Enter',
}

export function press(code: string, mods: Partial<KeyboardEventInit> = {}): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      code,
      key: KEY_OF_CODE[code] ?? '',
      bubbles: true,
      cancelable: true,
      ...mods,
    }),
  )
}

export const panes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.pane')]
export const visiblePanes = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('.session-host:not([hidden]) .pane'),
]
export const focusedId = (): string | undefined =>
  document.querySelector<HTMLElement>('.pane--focused')?.dataset['paneId']

export function trackOffset(): number {
  const track = document.querySelector<HTMLElement>('.session-host:not([hidden]) .canvas-track')
  const match = /translateX\((-?\d+)px\)/.exec(track?.style.transform ?? '')
  return match === null ? 0 : Number(match[1])
}

export async function openSession(displayName: string): Promise<void> {
  const rows = [...document.querySelectorAll<HTMLButtonElement>('.sidebar__open')]
  const match = rows.find((row) => row.querySelector('.sidebar__name')?.textContent === displayName)
  ;(match ?? rows[0])?.click()
  await sleep(2600)
}

/**
 * Are frames actually arriving?
 *
 * Scroll checks need frames, not focus — Chromium stops compositing an occluded
 * window, so count rAF callbacks rather than trusting document.hasFocus().
 */
export async function animationRuns(): Promise<boolean> {
  let frames = 0
  const start = performance.now()
  /*
   * An occluded window never calls back, so rAF alone never settles and the
   * whole run hangs — reporting nothing at all instead of "skipped". The
   * deadline has to answer "unmeasurable" rather than pass on the frames
   * gathered so far: a throttled window collects a few over a whole second,
   * which is plenty to satisfy a count and nowhere near enough to time inertia.
   */
  const measured = await new Promise<boolean>((resolve) => {
    const giveUp = setTimeout(() => resolve(false), 1000)
    const tick = (): void => {
      frames++
      if (performance.now() - start >= 200) {
        clearTimeout(giveUp)
        resolve(true)
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  // ~12 at 60fps; half of that is still enough to measure inertia.
  return measured && frames >= 5
}

/** Marks an unmeasurable condition — deliberately not matched by FAIL_PATTERN. */
export const SKIPPED = 'skipped: window occluded, no frames arriving'

export async function claimFocus(report: Report, key: string): Promise<boolean> {
  let focused = false
  for (let attempt = 0; attempt < 3 && !focused; attempt++) {
    focused = await api.focusWindow()
    if (!focused) await sleep(400)
  }
  await sleep(200)
  // Not a verdict, a hint: Wayland can report false while everything still works.
  report[key] = focused ? 'ok' : 'note: window did not take focus (see wheel and clipboard below)'
  return focused
}

/** Count pty bytes per pane; WebGL draws to canvas so the DOM shows nothing. */
export function watchPtyBytes(): Map<string, number> {
  const bytes = new Map<string, number>()
  api.onData((paneId, data) => bytes.set(paneId, (bytes.get(paneId) ?? 0) + data.length))
  return bytes
}

/** Screenshot the current state — some layout faults are only visible. */
export async function capture(report: Report, name: string): Promise<void> {
  try {
    const path = `${String(import.meta.env.VITE_SHOT_DIR ?? '/tmp')}/termspace-${name}.png`
    /*
     * An occluded window stops compositing, so capturePage returns the last
     * frame drawn — the image can be seconds behind the DOM.
     */
    const stale = !(await animationRuns())
    const saved = await api.captureWindow(path)
    report[`shot_${name}`] = stale ? `${saved} (window occluded — frame may be stale)` : saved
  } catch (err) {
    report[`shot_${name}`] = `capture failed: ${err instanceof Error ? err.message : String(err)}`
  }
}
