/**
 * App-level self-check, started by `npm run verify:app`.
 *
 * Unit tests only cover pure logic. Whether ptys spawn, keys land, the canvas
 * glides and off-screen panes freeze can only be seen with the app running, so
 * the renderer drives its own UI and reports. Dev builds only.
 */
import { api } from '../api'
import {
  checkAppBarMenu,
  checkKeybindings,
  checkScrollbackSearch,
  checkSettings,
  checkSidebar,
  checkSplitControl,
} from './chrome'
import {
  checkAppKeysWithoutSession,
  checkClickableLinks,
  checkFocusVisibility,
  checkCanvasHostScrollLock,
  checkGridFillsPane,
  checkLayoutEditing,
  checkNavigation,
  checkOverview,
  checkOverviewScaleFloor,
  checkPaneTitlePeek,
  checkTerminalSignals,
  checkRendererBudget,
  checkSessionAndPty,
} from './core'
import {
  capture,
  claimFocus,
  FAIL_PATTERN,
  openSession,
  press,
  type Report,
  sleep,
  waitFor,
  watchPtyBytes,
} from './harness'
import { checkClipboard, checkRevealFocus, checkWheelScroll } from './motion'
import {
  checkAttentionClearsOnReturn,
  checkCloseGuard,
  checkCopyToast,
  checkErrorRowStaysDraggable,
  checkFileDrop,
  checkHeldSessionJump,
  checkImeInput,
  checkNewSession,
  checkResizeSync,
  checkSaveCurrentLayout,
  checkSaveSession,
  checkSessionStepShortcut,
  checkShellIntegration,
  checkSidebarNarrowName,
  checkSidebarReorder,
  checkWheelSessionSwitch,
} from './sessions'

/**
 * The checks, in independent groups.
 *
 * One process per group, run side by side, so the whole thing finishes in the
 * time of its slowest group instead of the sum. Each group opens the session
 * itself and each process gets its own config folder, so nothing one group does
 * — toggling a setting, saving a session — can reach another.
 *
 * Keep a group's checks in one process: they still run in order, and several
 * lean on what the one before them left on screen.
 */

const GROUPS: Readonly<
  Record<string, (report: Report, bytes: Map<string, number>) => Promise<void>>
> = {
  // Opening a session, and editing what is on screen.
  core: async (report, bytes) => {
    // No claimFocus here: only the motion group needs the active window, and
    // two processes pulling focus from each other would leave neither with it.
    // Must come first: it asserts that nothing is open yet.
    await checkAppKeysWithoutSession(report)
    await checkSessionAndPty(report, bytes)
    await capture(report, 'fresh')
    await checkNavigation(report)
    checkFocusVisibility(report)
    checkCanvasHostScrollLock(report)
    await checkPaneTitlePeek(report)
    await checkOverview(report)
    await checkOverviewScaleFloor(report)
    await checkTerminalSignals(report)
    await checkLayoutEditing(report)
    checkRendererBudget(report)
    await checkGridFillsPane(report)
    await checkClickableLinks(report)
  },

  // Anything that needs frames or the clipboard, which need an active window.
  motion: async (report) => {
    await openSession('verify')
    await claimFocus(report, 'windowFocusedForWheel')
    await checkWheelScroll(report)
    await capture(report, 'after-scroll')
    await checkRevealFocus(report)
    await checkClipboard(report, await claimFocus(report, 'windowFocusedForClipboard'))
  },

  // The app's own surfaces: menus, sidebar, settings.
  chrome: async (report) => {
    await openSession('verify')
    await checkAppBarMenu(report)
    await checkSplitControl(report)
    await capture(report, 'split-menu')
    // The dropdown was left open for the shot. An open menu swallows every
    // keydown at window capture, so close it before anything key-driven runs.
    press('Escape')
    await waitFor(() => document.querySelector<HTMLElement>('.command-menu:not([hidden])') === null)
    await checkSidebar(report)
    await capture(report, 'sidebar-collapsed-then-restored')
    await checkScrollbackSearch(report)
    await capture(report, 'search-closed')
    await checkSettings(report)
    await capture(report, 'settings')
    await checkKeybindings(report)
  },

  // Session files and terminal input.
  sessions: async (report) => {
    // Before anything else: the jump lands on the second row, and later checks
    // add sessions to the list, which would move it.
    await openSession('spare')
    await checkHeldSessionJump(report)
    await openSession('verify')
    await checkFileDrop(report)
    await checkImeInput(report)
    await checkResizeSync(report)
    await checkCloseGuard(report)
    await checkSaveSession(report)
    // After the save check: this one leaves a submitted command on the pane,
    // which is exactly what the save check reads.
    await checkShellIntegration(report)
    await checkCopyToast(report)
    await checkNewSession(report)
    await checkSaveCurrentLayout(report)
    await checkWheelSessionSwitch(report)
    await checkSessionStepShortcut(report)
    await checkAttentionClearsOnReturn(report)
    await checkSidebarReorder(report)
    await checkSidebarNarrowName(report)
    await checkErrorRowStaysDraggable(report)
  },
}

export const GROUP_NAMES = Object.keys(GROUPS)

export async function run(): Promise<void> {
  const asked = new URLSearchParams(location.search).get('scope') ?? 'all'
  const names = asked === 'all' ? GROUP_NAMES : asked.split(',')
  const report: Report = {}
  const bytes = watchPtyBytes()
  try {
    /*
     * Boot fetches settings, keybindings and the session list over IPC, and a
     * shortcut pressed before the bindings land matches nothing. The listed
     * sessions are the last thing boot draws, so they are the ready signal —
     * a fixed sleep was too short on a cold, shared machine.
     */
    await waitFor(() => document.querySelector('.sidebar__row') !== null, 20_000)
    // Nothing marks the end of boot: the list is the last thing drawn, and the
    // settings and bindings behind it arrive on IPC replies of their own.
    await sleep(300)
    for (const name of names) {
      const group = GROUPS[name]
      if (group === undefined) throw new Error(`no such group: ${name}`)
      await group(report, bytes)
    }
    report['result'] = Object.entries(report).some(
      ([key, value]) => key !== 'result' && FAIL_PATTERN.test(value),
    )
      ? 'FAIL'
      : 'PASS'
  } catch (err) {
    report['fatal'] = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    report['result'] = 'FAIL'
  }

  console.info('[SELF-CHECK] ===== BEGIN =====')
  for (const [key, value] of Object.entries(report)) console.info(`[SELF-CHECK] ${key}: ${value}`)
  console.info('[SELF-CHECK] ===== END =====')

  /*
   * Close as soon as the report is out, rather than waiting to be killed. With
   * groups running side by side the slowest one decides when the runner returns,
   * and a window that has nothing left to do should not sit on screen until then.
   */
  api.window.confirmClose()
}
