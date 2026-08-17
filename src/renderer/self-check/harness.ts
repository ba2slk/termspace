/**
 * Shared plumbing for the self-check groups.
 *
 * The checks themselves live in `core`, `motion`, `chrome` and `sessions`; this
 * is what all of them need — waiting, key synthesis, DOM lookups, screenshots.
 */
import {
  ACTION_IDS,
  chordFromEvent,
  DEFAULT_BINDINGS,
  DEFAULT_BINDINGS_MAC,
  DIGIT_CODE,
} from '../../shared/keybindings'
import { api } from '../api'
import { IS_MAC } from '../platform'

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

/**
 * Wait for a condition only main can answer.
 *
 * The clipboard and the session list are read over IPC, so the question cannot
 * be asked from inside `waitFor`'s synchronous predicate. `pollMs` is the gap
 * between asks: a round trip is not free, and a few of these hit shared state.
 */
export async function waitForAsync(
  done: () => Promise<boolean>,
  timeoutMs = 4000,
  pollMs = 200,
): Promise<boolean> {
  const until = performance.now() + timeoutMs
  for (;;) {
    if (await done()) return true
    if (performance.now() >= until) return false
    await sleep(pollMs)
  }
}

/**
 * Wait for a measurement to stop changing.
 *
 * The end of a glide is announced by nothing: inertia just runs out. One
 * unchanged reading is not enough — a throttled rAF holds the value still for a
 * while — so require several consecutive quiet reads.
 */
export async function holdsStill(read: () => number, timeoutMs = 4000): Promise<number> {
  const until = performance.now() + timeoutMs
  let last = read()
  let quiet = 0
  while (performance.now() < until && quiet < 4) {
    // The poll interval, not a guess at how long the glide runs.
    await sleep(80)
    const now = read()
    quiet = now === last ? quiet + 1 : 0
    last = now
  }
  return read()
}

/** The canvas glide, settled. Returns where it came to rest. */
export const trackSettles = async (timeoutMs = 4000): Promise<number> =>
  holdsStill(trackOffset, timeoutMs)

/** Shortcuts match on `code`, but dialogs listen on `key`, so fill in both. */
export const KEY_OF_CODE: Readonly<Record<string, string>> = {
  Escape: 'Escape',
  Enter: 'Enter',
}

/**
 * Every default chord in its Linux spelling, paired with the mac one for the
 * same action. Both tables list the same actions in the same order, so the
 * pairing is positional.
 */
const MAC_CHORD: ReadonlyMap<string, string> = new Map(
  ACTION_IDS.flatMap((id) =>
    DEFAULT_BINDINGS[id].flatMap((chord, i) => {
      const mac = DEFAULT_BINDINGS_MAC[id][i]
      return mac === undefined ? [] : [[chord, mac] as const]
    }),
  ),
)

/**
 * The checks name their chords the way a Linux user types them. On mac the same
 * action lives on a different chord — Cmd, and not always a plain mirror — so a
 * press is translated through the action it stands for. A chord that is not a
 * default (one a check has just bound itself, or one meant to reach the pty) is
 * pressed exactly as written on both platforms.
 */
function forThisPlatform(code: string, mods: Partial<KeyboardEventInit>): KeyboardEventInit {
  const asPressed = { code, ...mods }
  if (!IS_MAC) return asPressed
  const linux = chordFromEvent({
    code,
    ctrlKey: mods.ctrlKey === true,
    altKey: mods.altKey === true,
    shiftKey: mods.shiftKey === true,
    metaKey: mods.metaKey === true,
  })
  const mac = linux === null ? undefined : MAC_CHORD.get(linux)
  if (mac === undefined) return asPressed
  const parts = mac.split('+')
  return {
    // The digit chords are stored collapsed, so the pressed key stays the key.
    code: parts[parts.length - 1] === DIGIT_CODE ? code : (parts[parts.length - 1] as string),
    ctrlKey: parts.includes('Ctrl'),
    altKey: parts.includes('Alt'),
    shiftKey: parts.includes('Shift'),
    metaKey: parts.includes('Meta'),
  }
}

export function press(code: string, mods: Partial<KeyboardEventInit> = {}): void {
  const init = forThisPlatform(code, mods)
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: KEY_OF_CODE[code] ?? '',
      bubbles: true,
      cancelable: true,
      ...mods,
      ...init,
    }),
  )
}

/*
 * The renderer's canvas. xterm keeps a second canvas per terminal for the
 * overview ruler, which the overviewRuler option turns on for its width alone,
 * so "has a canvas" is no longer the same as "has a renderer".
 */
export const RENDERER_CANVAS = 'canvas:not(.xterm-decoration-overview-ruler)'

export const panes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.pane')]
export const visiblePanes = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('.session-host:not([hidden]) .pane'),
]
export const focusedId = (): string | undefined =>
  document.querySelector<HTMLElement>('.pane--focused')?.dataset['paneId']

/** The overview, while it is open over the session on screen. */
export const overlay = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('.session-host:not([hidden]) .overview')

/** The pane the open overview has selected. */
export const selectedCard = (): string | undefined =>
  overlay()?.querySelector<HTMLElement>('.overview__card--selected')?.dataset['paneId']

/** A session's row in the list, by file name. */
export const rowOf = (id: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('.sidebar__row')].find(
    (row) => row.dataset['sessionId'] === id,
  )

/**
 * The xterm instance behind a pane, through the dev seam the renderer parks on
 * the host element. One type for every check: what a terminal offers does not
 * depend on who is asking.
 */
export interface TermSeam {
  cols: number
  rows: number
  options: { theme?: { background?: string } }
  buffer: { active: { viewportY: number; cursorY: number } }
  selectAll(): void
  getSelection(): string
  clear(): void
  write(data: string, cb?: () => void): void
}

export interface HoveredLink {
  text: string
  range: { start: { x: number }; end: { x: number } }
}

export const termOf = (host: Element | null | undefined): TermSeam | undefined =>
  (host as unknown as { __term?: TermSeam } | null | undefined)?.__term

/** The terminal host of the focused pane — what most checks type into. */
export const focusedHost = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('.pane--focused .terminal-host')

export const hoveredLinkOf = (host: Element | null | undefined): HoveredLink | null =>
  (host as unknown as { __hoveredLink?: HoveredLink | null } | null | undefined)?.__hoveredLink ??
  null

/** One wheel notch, on whatever is meant to receive it. */
export function wheel(
  target: EventTarget | null | undefined,
  deltaX: number,
  deltaY: number,
  deltaMode = 0,
): void {
  target?.dispatchEvent(
    new WheelEvent('wheel', { deltaX, deltaY, deltaMode, bubbles: true, cancelable: true }),
  )
}

export function trackOffset(): number {
  const track = document.querySelector<HTMLElement>('.session-host:not([hidden]) .canvas-track')
  const match = /translateX\((-?\d+)px\)/.exec(track?.style.transform ?? '')
  return match === null ? 0 : Number(match[1])
}

export async function openSession(displayName: string): Promise<void> {
  const rows = [...document.querySelectorAll<HTMLButtonElement>('.sidebar__open')]
  const match = rows.find((row) => row.querySelector('.sidebar__name')?.textContent === displayName)
  // A fallback row is whichever session was first, so its name proves nothing.
  const wanted = match === undefined ? null : displayName
  ;(match ?? rows[0])?.click()
  /*
   * Opening spawns a pty per pane and the title follows the session. Wait for
   * both: the panes appear a frame before the terminals are attached, and a
   * check that starts typing in between types into nothing.
   */
  await waitFor(
    () =>
      (wanted === null || document.title.includes(wanted)) &&
      visiblePanes().length > 0 &&
      visiblePanes().every((pane) => pane.querySelector('.terminal-host') !== null) &&
      // A renderer attached is the session drawing, not merely built.
      visiblePanes().some((pane) => pane.querySelector(RENDERER_CANVAS) !== null),
    15_000,
  )
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
    // Nothing to observe between tries: the window manager answers when it
    // answers, and its refusal is the only signal there is.
    if (!focused) await sleep(400)
  }
  // The compositor can report focus a frame before the page holds it.
  await waitFor(() => document.hasFocus(), 600)
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
