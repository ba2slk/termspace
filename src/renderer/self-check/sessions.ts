import { api } from '../api'
import { t } from '../i18n'
import { maxColumnWidth } from '../layout-geometry'
import { MAX_WEBGL_CONTEXTS } from '../renderer-budget'
import {
  capture,
  focusedHost,
  focusedId,
  holdsStill,
  openSession,
  panes,
  press,
  RENDERER_CANVAS,
  type Report,
  resolveColor,
  rowOf,
  sleep,
  termOf,
  trackSettles,
  visiblePanes,
  waitFor,
  waitForAsync,
  wheel,
} from './harness'

/** The dropdown currently open, and its entries. */
const menuItems = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>('.command-menu:not([hidden]) .command-menu__item'),
]

/**
 * The save/create dialog is built once and toggled, so its fields are in the
 * DOM whether or not it is open — waiting for one of them would wait for
 * nothing. The confirm dialog shares the class, hence the exclusion.
 */
const saveDialogOpen = (): boolean =>
  document.querySelector<HTMLElement>('.save-session:not(.confirm-close)')?.hidden === false

/**
 * Has the dialog caught up with the name typed into it?
 *
 * Whether a name is taken is one IPC round trip, and nothing on screen moves
 * until the reply lands — the button keeps the wording and the disabled state
 * it had for the name before. The path line is redrawn by the same pass, so it
 * is what says the controls beside it now mean what they read.
 */
const dialogChecked = async (id: string): Promise<boolean> =>
  waitFor(
    () => document.querySelector('.save-session__path')?.textContent?.includes(`${id}.yaml`) === true,
    3000,
  )

const refreshList = (): void => {
  ;[...document.querySelectorAll<HTMLButtonElement>('.sidebar__action')]
    .find((b) => b.title === t.sidebar.refreshList)
    ?.click()
}

const pinnedSlot = (): HTMLElement | null => document.querySelector<HTMLElement>('.sidebar__pinned')
/** The slot's row stays when its terminal ends; the button that ends one is there only while one runs. */
const terminalRuns = (): boolean => pinnedSlot()?.querySelector('.sidebar__close') != null

/**
 * A window resized with a pane open: that pane's width was fixed before, so it
 * cannot be held against the canvas now. Listening from import, before boot.
 */
let resizedWithPane = false
window.addEventListener('resize', () => {
  if (document.querySelector('.pane') !== null) resizedWithPane = true
})

/** Does the one pane on screen fill the canvas beside the sidebar, as a new column should? */
const fillsCanvas = (resized = false): string => {
  const host = document.querySelector<HTMLElement>('.session-host:not([hidden])')
  const pane = visiblePanes()[0]?.getBoundingClientRect().width
  if (host === null || pane === undefined) return 'skipped: no session or pane on screen'
  const want = maxColumnWidth(host.clientWidth)
  if (Math.abs(pane - want) <= 1) return 'ok'
  const widths = `pane ${String(pane)} canvas ${String(want)}`
  return resized ? `skipped: the window resized after the pane opened (${widths})` : `FAIL (${widths})`
}

/**
 * What a launch opens, then closed again: every group starts from nothing open.
 * Runs in each process before its groups.
 */
export async function checkDefaultTerminalAtLaunch(report: Report): Promise<void> {
  await waitFor(() => terminalRuns() && visiblePanes().length > 0, 15_000)
  report['defaultTerminalAtLaunch'] =
    terminalRuns() && visiblePanes().length === 1 ? 'ok' : `FAIL (${String(visiblePanes().length)} panes)`

  const term = termOf(focusedHost())
  report['defaultTerminalShell'] =
    term === undefined
      ? 'FAIL (no terminal)'
      : (await waitFor(() => {
          term.selectAll()
          return term.getSelection().trim() !== ''
        }, 8000))
        ? 'ok'
        : 'skipped: the shell printed nothing (no prompt configured?)'
  report['defaultTerminalFillsCanvas'] = fillsCanvas(resizedWithPane)

  // Drawn above the list, not merely before it in the DOM.
  const slot = pinnedSlot()?.getBoundingClientRect()
  const list = document.querySelector<HTMLElement>('.sidebar__list')?.getBoundingClientRect()
  report['defaultTerminalAboveList'] =
    slot !== undefined && list !== undefined && slot.height > 0 && slot.bottom <= list.top + 1
      ? 'ok'
      : `FAIL (slot ${String(slot?.bottom)} list ${String(list?.top)})`
  const line = pinnedSlot() === null ? null : getComputedStyle(pinnedSlot()!)
  // Border widths snap to device pixels, so 1px reads as 0.6px at dpr 1.67.
  const width = Number.parseFloat(line?.borderBottomWidth ?? '')
  report['defaultTerminalHairline'] =
    line !== null && line.borderBottomStyle === 'solid' && width > 0 && width <= 1
      ? 'ok'
      : `FAIL (${String(line?.borderBottomStyle)} ${String(line?.borderBottomWidth)})`

  pinnedSlot()?.querySelector<HTMLButtonElement>('.sidebar__close')?.click()
  await waitFor(() => !terminalRuns() && visiblePanes().length === 0)
  report['defaultTerminalEnds'] =
    !terminalRuns() && visiblePanes().length === 0 ? 'ok' : 'FAIL (still running)'

  // The row outlives its terminal, in the same place, and is the way back to one.
  const stayed = pinnedSlot()?.querySelector<HTMLElement>('.sidebar__row')?.getBoundingClientRect()
  const listNow = document.querySelector<HTMLElement>('.sidebar__list')?.getBoundingClientRect()
  report['defaultTerminalRowStays'] =
    stayed !== undefined && listNow !== undefined && stayed.height > 0 && stayed.bottom <= listNow.top + 1
      ? 'ok'
      : `FAIL (row ${String(stayed?.height)} high, bottom ${String(stayed?.bottom)}, list ${String(listNow?.top)})`
  pinnedSlot()?.querySelector<HTMLButtonElement>('.sidebar__open')?.click()
  const reopened = await waitFor(() => terminalRuns() && visiblePanes().length === 1, 15_000)
  report['defaultTerminalRowReopens'] = reopened ? 'ok' : `FAIL (${String(visiblePanes().length)} panes)`
  pinnedSlot()?.querySelector<HTMLButtonElement>('.sidebar__close')?.click()
  await waitFor(() => !terminalRuns() && visiblePanes().length === 0)
}

/**
 * The default terminal becomes a session in place: same pty, root from where the
 * shell stands, a taken name refused. First in its group: it needs the empty
 * canvas, so whatever is open is ended first.
 */
export async function checkDefaultTerminalSave(report: Report): Promise<void> {
  for (const close of document.querySelectorAll<HTMLButtonElement>('.sidebar__close')) close.click()
  await waitFor(() => visiblePanes().length === 0)

  const newTerminal = document.querySelector<HTMLButtonElement>('.canvas-empty__terminal')
  report['newTerminalFocused'] =
    newTerminal !== null && document.activeElement === newTerminal ? 'ok' : 'FAIL (not focused)'
  // A synthetic Enter does not press a button; Enter itself is in MANUAL-QA.
  newTerminal?.click()
  await waitFor(() => terminalRuns() && visiblePanes().length === 1, 15_000)
  report['newTerminalFillsCanvas'] = fillsCanvas()
  const paneId = focusedId()
  const term = termOf(focusedHost())
  if (paneId === undefined || term === undefined) {
    report['defaultTerminalSave'] = 'FAIL (no terminal after New terminal)'
    return
  }

  api.write(paneId, 'cd / && echo selfcheck-marker-7\n')
  // The typed line and its output both carry the marker: two means it ran.
  const markers = (): number => {
    term.selectAll()
    return term.getSelection().split('selfcheck-marker-7').length - 1
  }
  await waitFor(() => markers() >= 2, 5000)

  press('KeyS', { altKey: true, shiftKey: true })
  await waitFor(saveDialogOpen)
  const field = document.querySelector<HTMLInputElement>('.save-session__input')
  const cwdField = document.querySelector<HTMLInputElement>('.save-session__cwd')
  report['defaultTerminalSaveNameEmpty'] = field?.value === '' ? 'ok' : `FAIL (${String(field?.value)})`
  report['defaultTerminalSaveRoot'] = cwdField?.value === '/' ? 'ok' : `FAIL (${String(cwdField?.value)})`

  // Taken: 'verify' is every group's session.
  if (field !== null) {
    field.value = 'verify'
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
  await dialogChecked('verify')
  const button = document.querySelector<HTMLButtonElement>('.save-session .button--accent')
  report['defaultTerminalRefusesTaken'] =
    button?.disabled === true &&
    document.querySelector('.save-session__status')?.textContent === t.saveSession.nameTakenPickAnother
      ? 'ok'
      : 'FAIL (a taken name could be overwritten)'

  const name = 'selfcheck-terminal'
  if (field !== null) {
    field.value = name
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
  await dialogChecked(name)
  button?.click()
  await waitFor(() => !saveDialogOpen() && !terminalRuns(), 5000)
  report['defaultTerminalSaved'] =
    !terminalRuns() && document.title.includes(name) ? 'ok' : `FAIL (title ${document.title})`

  // Same pty: what the shell printed before the save is still on screen.
  term.selectAll()
  report['defaultTerminalKeepsPty'] =
    termOf(focusedHost()) === term && term.getSelection().includes('selfcheck-marker-7')
      ? 'ok'
      : 'FAIL (the terminal was replaced)'

  document
    .querySelector<HTMLElement>('.sidebar__row--current')
    ?.querySelector<HTMLButtonElement>('.sidebar__close')
    ?.click()
  await api.deleteSession(name)
  refreshList()
  await waitFor(() => visiblePanes().length === 0)
}

/**
 * A file dropped on a terminal.
 *
 * The file path itself can't be faked — a File carries no path unless the
 * platform put one there. What this pins down is the part that would be
 * catastrophic: Chromium's default is to navigate to the dropped file, which
 * would replace the running app with its contents.
 */
export async function checkFileDrop(report: Report): Promise<void> {
  const host = document.querySelector<HTMLElement>('.pane--focused .terminal-host')
  if (host === null) {
    report['fileDrop'] = 'FAIL (no focused terminal)'
    return
  }

  const transfer = new DataTransfer()
  transfer.setData('text/plain', 'DROPPED')
  const over = new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true })
  host.dispatchEvent(over)
  report['dropTargetAccepts'] = over.defaultPrevented ? 'ok' : 'FAIL (drag not accepted)'

  const drop = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
  host.dispatchEvent(drop)
  // Nothing positive to wait for: give a navigation the time it would need.
  await waitFor(() => document.querySelector('.pane--focused') === null, 300)
  report['dropDoesNotNavigate'] = drop.defaultPrevented ? 'ok' : 'FAIL (Chromium would open the file)'
  report['dropKeptTheApp'] =
    document.querySelector('.pane--focused') !== null ? 'ok' : 'FAIL (the page went away)'
}

/**
 * Does IME composition reach the pty exactly once?
 *
 * xterm can send from two places on commit, and both firing duplicates the
 * character. `cat` echoes whatever arrives, so this counts what the pty
 * actually received rather than what the app claims it sent.
 */
/**
 * The shell hook's sequences must reach main, and the output around them must
 * survive the scanner untouched.
 *
 * Emitted with printf rather than by installing the hook: a check has no
 * business editing anyone's ~/.bashrc, and the hook's own behaviour is settled
 * by unit tests and by MANUAL-QA.
 */
export async function checkShellIntegration(report: Report): Promise<void> {
  const paneId = focusedId()
  const term = termOf(focusedHost())
  if (paneId === undefined || term === undefined) {
    report['shellHook'] = 'FAIL (could not reach the terminal instance)'
    return
  }
  const selection = (): string => {
    term.selectAll()
    return term.getSelection()
  }

  // The shell echoes the line it is given, so the marker is assembled by printf
  // itself — searching for a marker that also sits in the echo finds the echo.
  const marker = 'SHELLHOOKOK'
  const payload = btoa('qatn')
  // Earlier checks can leave text sitting on the prompt; clear the line first.
  // The pty reads what it is given in order, so nothing has to be waited for.
  api.write(paneId, '\u0015')
  // Both sequences, wrapped in ordinary text that must still be drawn.
  api.write(
    paneId,
    `printf 'A\\033]1173;A\\007B\\033]1173;C;${payload}\\007C SHELLHOOK%s\\n' OK\n`,
  )

  await waitFor(() => selection().includes(`ABC ${marker}`), 6000)
  const text = selection()
  report['shellHookKeptOutput'] = text.includes(`ABC ${marker}`)
    ? 'ok'
    : text.includes(marker)
      ? `FAIL (text around the sequence was eaten: ${JSON.stringify(text.slice(text.indexOf(marker) - 12, text.indexOf(marker) + 12))})`
      : 'skipped (the marker never printed; the shell did not start)'

  const active = await waitForAsync(async () => (await api.shellIntegrationStatus()).active, 4000)
  report['shellHookReceived'] = active ? 'ok' : 'FAIL (the sourced marker never reached main)'
}

export async function checkImeInput(report: Report): Promise<void> {
  const paneId = focusedId()
  const hostEl = focusedHost()
  const textarea = hostEl?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
  const term = termOf(hostEl)
  if (paneId === undefined || textarea === undefined || textarea === null || term === undefined) {
    report['imeSingleInsert'] = 'FAIL (could not reach the terminal input element)'
    return
  }

  // cat echoes plainly; a shell line editor would obscure who drew what.
  const selection = (): string => {
    term.selectAll()
    return term.getSelection()
  }
  api.write(paneId, 'cat\n')
  // The shell echoes the line it was given, and then hands the tty over: wait
  // for that echo, and for the screen to go quiet behind it.
  await waitFor(() => selection().includes('cat'), 6000)
  await holdsStill(() => selection().length, 2000)
  term.clear()
  await waitFor(() => !selection().includes('cat'), 1000)

  const key = (init: KeyboardEventInit): void => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))
  }
  const comp = (type: string, data: string): void => {
    textarea.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }))
  }
  const input = (data: string, isComposing: boolean): void => {
    textarea.dispatchEvent(
      new InputEvent('input', {
        data,
        isComposing,
        inputType: isComposing ? 'insertCompositionText' : 'insertFromComposition',
        bubbles: true,
      }),
    )
  }

  /*
   * Hangul used as IME input (jamo H, syllables HA/HAN/AN), escaped so the
   * source carries no literal Hangul.
   */
  const JAMO_H = '\\u314E'
  const HA = '\\uD558'
  const HAN = '\\uD55C'
  const AN = '\\uC548'

  /*
   * Event order differs per IME, so walk every plausible sequence.
   *
   * The sleeps inside a scenario are the IME's own timing — the gap xterm's
   * zero-delay timer needs to have run in, and the pause between keystrokes.
   * They stand for a human typing, not for the app catching up.
   */
  const scenarios: readonly { readonly name: string; readonly run: () => Promise<void> }[] = [
    {
      // Committed by typing the next character, with keydown still marked composing.
      name: 'commit-while-composing',
      run: async () => {
        key({ keyCode: 229 })
        comp('compositionstart', '')
        for (const step of [JAMO_H, HA, HAN]) {
          textarea.value = step
          comp('compositionupdate', step)
          input(step, true)
          await sleep(30)
          key({ keyCode: 229, isComposing: true })
        }
        comp('compositionend', HAN)
        input(HAN, false)
      },
    },
    {
      // Commit first, then the same key opens the next composition (ibus-hangul).
      name: 'commit-then-restart',
      run: async () => {
        key({ keyCode: 229 })
        comp('compositionstart', '')
        textarea.value = HAN
        comp('compositionupdate', HAN)
        input(HAN, true)
        await sleep(30)
        comp('compositionend', HAN)
        input(HAN, false)
        key({ keyCode: 229, isComposing: false })
        comp('compositionstart', '')
        await sleep(30)
        comp('compositionend', '')
      },
    },
    {
      // A pause after commit, so xterm's zero-delay timer has already run.
      name: 'commit-then-idle-key',
      run: async () => {
        key({ keyCode: 229 })
        comp('compositionstart', '')
        textarea.value = HAN
        comp('compositionupdate', HAN)
        input(HAN, true)
        await sleep(30)
        comp('compositionend', HAN)
        input(HAN, false)
        await sleep(120)
        key({ keyCode: 229, isComposing: false })
      },
    },
    {
      /*
       * The double-input path: a keydown mid-composition carrying a real key
       * code instead of 229. xterm sends the syllable there and again on the
       * compositionend behind it; `ime-double-commit` drops the second.
       */
      name: 'real-keycode-while-composing',
      run: async () => {
        key({ keyCode: 229 })
        comp('compositionstart', '')
        textarea.value = HAN
        comp('compositionupdate', HAN)
        input(HAN, true)
        await sleep(30)
        key({ keyCode: 65, key: 'Process', isComposing: true })
        comp('compositionend', HAN)
        input(HAN, false)
      },
    },
    {
      // Composition without input events — some IMEs omit them.
      name: 'no-input-event',
      run: async () => {
        key({ keyCode: 229 })
        comp('compositionstart', '')
        textarea.value = HAN
        comp('compositionupdate', HAN)
        await sleep(30)
        comp('compositionend', HAN)
      },
    },
  ]

  /*
   * Count the delta around each scenario.
   *
   * clear() only empties the scrollback, leaving the cursor line, so echoed
   * characters accumulate and absolute counts would read as duplication.
   */
  const seen = (): number => selection().split(HAN).length - 1

  const wrong: string[] = []
  for (const scenario of scenarios) {
    textarea.value = ''
    const before = seen()
    await scenario.run()
    // The echo comes back over the pty. Wait for it, then for it to stop: a
    // duplicate that arrived late is exactly what this check is counting.
    await waitFor(() => seen() > before, 3000)
    await holdsStill(seen, 2000)
    const delta = seen() - before
    report[`ime_${scenario.name}`] = `${String(delta)}`
    if (delta !== 1) wrong.push(`${scenario.name}=${String(delta)}`)
  }

  report['imeSingleInsert'] =
    wrong.length === 0 ? 'ok' : `FAIL (not exactly once: ${wrong.join(', ')})`

  /*
   * Where the composing character is drawn.
   *
   * xterm overlays a box at the cursor while composing, and its own CSS carries
   * "Composition position got messed up somewhere". Off by a row it leaves a
   * stripe above the line being typed.
   */
  // Bring the pane back on screen, or the capture below shows nothing.
  wheel(document.querySelector<HTMLElement>('.session-host:not([hidden])'), 0, -100_000)
  await trackSettles()

  // Push the cursor off the first row; an off-by-one row is invisible at row 0.
  const cursorRow = (): number => term.buffer.active.cursorY
  const rowBefore = cursorRow()
  api.write(paneId, 'x\nx\nx\n')
  await waitFor(() => cursorRow() > rowBefore, 3000)
  textarea.value = ''
  key({ keyCode: 229 })
  comp('compositionstart', '')
  textarea.value = AN
  comp('compositionupdate', AN)
  input(AN, true)
  // The overlay is drawn when xterm has taken the composition.
  await waitFor(
    () => hostEl?.querySelector<HTMLElement>('.composition-view')?.classList.contains('active') === true,
    2000,
  )

  const view = hostEl?.querySelector<HTMLElement>('.composition-view')
  const screen = hostEl?.querySelector<HTMLElement>('.xterm-screen')
  if (view != null && screen != null) {
    const viewBox = view.getBoundingClientRect()
    const screenBox = screen.getBoundingClientRect()
    const style = getComputedStyle(view)
    report['imeBoxActive'] = view.classList.contains('active') ? 'ok' : 'not active'
    report['imeBoxOffset'] =
      `${(viewBox.left - screenBox.left).toFixed(1)},${(viewBox.top - screenBox.top).toFixed(1)} into the screen`
    report['imeBoxSize'] = `${viewBox.width.toFixed(1)}x${viewBox.height.toFixed(1)}`
    report['imeBoxPaint'] = `${style.backgroundColor} / ${style.color}`
    /*
     * The overlay must wear the palette. xterm's own rule is #000 on #FFF,
     * which drops a black block onto a themed terminal while you type.
     */
    const paneEl = document.querySelector<HTMLElement>('.pane--focused')
    const paneBg = paneEl === null ? '?' : getComputedStyle(paneEl).backgroundColor
    report['imeBoxFollowsTheme'] =
      style.backgroundColor === paneBg
        ? 'ok'
        : `FAIL (${style.backgroundColor} over a ${paneBg} terminal)`
    report['imeBoxUnderlined'] =
      style.textDecorationLine === 'underline' ? 'ok' : `FAIL (${style.textDecorationLine})`
    // Whatever the pointer would hit at the box's centre is what the eye sees.
    const onTop = document.elementFromPoint(
      viewBox.left + viewBox.width / 2,
      viewBox.top + viewBox.height / 2,
    )
    report['imeBoxOnTop'] = `${onTop?.className ?? 'nothing'} (view z=${style.zIndex})`
    report['imeDevicePixelRatio'] = String(devicePixelRatio)
    // The row it lands on against the row the cursor is really on.
    const cursorY = (term as unknown as { buffer?: { active?: { cursorY?: number } } }).buffer
      ?.active?.cursorY
    report['imeBoxRow'] =
      `box row ${((viewBox.top - screenBox.top) / viewBox.height).toFixed(2)} vs cursor row ${String(cursorY)}`
    await capture(report, 'ime-composing')
  } else {
    report['imeBoxActive'] = 'skipped (no composition view)'
  }
  comp('compositionend', AN)
  input(AN, false)
  await waitFor(
    () => hostEl?.querySelector<HTMLElement>('.composition-view')?.classList.contains('active') !== true,
    2000,
  )

  api.write(paneId, '\u0003') // end cat
  /*
   * The next check types at the prompt, so wait for a shell that answers.
   * The marker is assembled by printf: while cat is still running it echoes
   * the line itself, and a marker written whole would match its own echo.
   */
  api.write(paneId, `printf 'IMEDO%s\\n' NE\n`)
  await waitFor(() => selection().includes('IMEDONE'), 8000)
}

/**
 * Saving the layout. Checks the file reappears in the list, since a file the
 * app can't read back is worthless.
 */
export async function checkSaveSession(report: Report): Promise<void> {
  /*
   * Capturing what a pane runs needs the hook sourced by the user's own rc, so
   * a machine that never added RC_LINE (a CI runner) can't be asked for it.
   * Read it before writing anything: this is about the shell, not the save.
   */
  const hooked = (await api.shellIntegrationStatus()).active

  // Start a long-running job first, so the save has something to capture.
  const capturePane = focusedId()
  const term = termOf(focusedHost())
  if (capturePane !== undefined) {
    api.write(capturePane, 'sleep 300\n')
    // The hook reports the command once the shell has taken the line.
    if (term !== undefined) {
      await waitFor(() => {
        term.selectAll()
        return term.getSelection().includes('sleep 300')
      }, 5000)
    }
  }

  const menu = document.querySelector<HTMLElement>('.app-bar__btn')
  menu?.click()
  await waitFor(() => menuItems().length > 0)

  const item = menuItems().find((b) => b.textContent?.includes(t.firstRun.saveLayoutAs))
  if (item === undefined) {
    report['saveSessionMenu'] = 'FAIL (the menu has no such item)'
    return
  }
  report['saveSessionMenu'] = 'ok'
  item.click()
  await waitFor(saveDialogOpen)

  const field = document.querySelector<HTMLInputElement>('.save-session__input')
  const button = document.querySelector<HTMLButtonElement>('.save-session .button--accent')
  if (field === null || button === null) {
    report['saveSessionOpens'] = 'FAIL (the dialog did not open)'
    return
  }
  report['saveSessionOpens'] = 'ok'

  // Must be a fresh name; an existing one takes the overwrite path.
  const name = 'selfcheck-saved'
  field.value = name
  field.dispatchEvent(new Event('input', { bubbles: true }))

  const cwdField = document.querySelector<HTMLInputElement>('.save-session__cwd')
  report['saveDialogHasCwd'] =
    cwdField === null ? 'FAIL (no base-directory field)' : `ok (${cwdField.value})`
  if (cwdField !== null) {
    cwdField.value = '~/selfcheck-root'
    cwdField.dispatchEvent(new Event('input', { bubbles: true }))
  }

  await dialogChecked(name)
  report['saveButtonSaysSave'] = button.textContent === t.saveSession.save ? 'ok' : `FAIL (${String(button.textContent)})`

  // Present in the DOM is not the same as visible — stacking or size can hide it.
  const layer = document.querySelector<HTMLElement>('.save-session')
  const box = layer?.getBoundingClientRect()
  const cardBox = document.querySelector<HTMLElement>('.save-session__card')?.getBoundingClientRect()
  report['saveDialogBox'] =
    box === undefined ? 'none' : `${Math.round(box.width)}x${Math.round(box.height)}`
  report['saveDialogCard'] =
    cardBox === undefined ? 'none' : `${Math.round(cardBox.width)}x${Math.round(cardBox.height)}`
  report['saveDialogVisible'] =
    box !== undefined && box.width > 0 && box.height > 0 && cardBox !== undefined && cardBox.height > 0
      ? 'ok'
      : 'FAIL (present in the DOM but occupying no space)'
  // Nothing may paint above this dialog.
  const openMenus = [...document.querySelectorAll<HTMLElement>('.command-menu')].filter(
    (m) => !m.hidden,
  )
  report['saveDialogOnTop'] =
    openMenus.length === 0 ? 'ok' : `FAIL (${String(openMenus.length)} dropdowns above it)`

  // Capture while it is open.
  await capture(report, 'save-session')

  const before = (await api.listSessions()).length
  button.click()
  await waitForAsync(async () => (await api.listSessions()).some((s) => s.id === name), 8000)

  const after = await api.listSessions()
  const saved = after.find((s) => s.id === name)
  report['sessionFileWritten'] = saved === undefined ? 'FAIL (never appeared in the list)' : 'ok'
  report['savedSessionReadable'] =
    saved === undefined || saved.error !== null
      ? `FAIL (${saved?.error ?? 'none'})`
      : `ok (${String(saved.paneCount)} panes)`
  report['sessionListGrew'] = after.length > before ? 'ok' : 'FAIL'

  // Root cwd and the captured command only exist in the file — read it back.
  const roundTrip = await api.loadSession(name)
  const rootOk = roundTrip.spec?.cwd.endsWith('/selfcheck-root') ?? false
  report['savedRootCwd'] = rootOk ? 'ok' : `FAIL (${String(roundTrip.spec?.cwd)})`
  const commands =
    roundTrip.spec?.columns.flatMap((c) =>
      c.panes.map((p) => (p.kind === 'pane' ? p.command : null)),
    ) ?? []
  report['savedCapturedCommand'] = !hooked
    ? 'skipped (no pane has the shell hook; rc line not installed here)'
    : commands.includes('sleep 300')
      ? 'ok'
      : `FAIL (${commands.map(String).join(',') || 'none'})`
  // Undo: the sleeping pane must not outlive this check. The pty takes the
  // interrupt in order behind the writes above, so there is nothing to wait for.
  if (capturePane !== undefined) api.write(capturePane, '\x03')

  // Reopening with an existing name must not silently overwrite.
  menu?.click()
  await waitFor(() => menuItems().length > 0)
  menuItems()
    .find((b) => b.textContent?.includes(t.firstRun.saveLayoutAs))
    ?.click()
  await waitFor(saveDialogOpen)
  const field2 = document.querySelector<HTMLInputElement>('.save-session__input')
  if (field2 !== null) {
    field2.value = name
    field2.dispatchEvent(new Event('input', { bubbles: true }))
    const button2 = (): HTMLButtonElement | null =>
      document.querySelector<HTMLButtonElement>('.save-session .button--accent')
    // The path line already reads this name from the save above, so the warning
    // the taken name raises is what says this reply has landed.
    await waitFor(() => document.querySelector('.save-session__status--warn') !== null, 3000)
    report['overwriteNeedsConsent'] =
      button2()?.textContent === t.saveSession.overwrite
        ? 'ok'
        : `FAIL (${String(button2()?.textContent)})`
  }
  press('Escape')
  await waitFor(() => !saveDialogOpen())
}

/**
 * Saving over the open session's own file, straight from the bar.
 *
 * Seeded with a session the dialog could not have produced: its file name and
 * its display name disagree. That is the ordinary case for a hand-written file
 * and it is what the direct save used to get wrong — deriving a file name from
 * the display name wrote a *second* file, silently, since the derived name was
 * free. Nothing on screen said so; only the list quietly grew. So the assertion
 * is on the list not growing, not on the write succeeding.
 */
export async function checkSaveCurrentLayout(report: Report): Promise<void> {
  const id = 'selfcheck-mismatch'
  const displayName = 'Self check mismatched name'
  const seeded = await api.saveSessionAs(
    id,
    displayName,
    {
      columns: [
        {
          width: 640,
          panes: [
            {
              paneId: 'seed',
              title: 'shell',
              command: null,
              prefill: null,
              herdr: null,
              minimized: false,
              fallbackCwd: '~',
              heightRatio: 1,
            },
          ],
        },
      ],
    },
    true,
    '~',
  )
  if (!seeded.ok) {
    report['saveCurrentSeeded'] = `FAIL (${seeded.error ?? 'unknown'})`
    return
  }
  report['saveCurrentSeeded'] = 'ok'

  refreshList()
  await waitFor(() => rowOf(id) !== undefined)
  await openSession(displayName)
  if (!document.title.includes(displayName)) {
    report['saveCurrentOpened'] = `FAIL (${document.title})`
    return
  }
  report['saveCurrentOpened'] = 'ok'

  // Split, so a successful write is distinguishable from no write at all.
  const before = (await api.listSessions()).map((s) => s.id)
  const bar = [...document.querySelectorAll<HTMLButtonElement>('.app-bar__btn')]
  const saveButton = bar.find((b) => b.dataset['action'] === 'save-layout')
  if (saveButton === undefined) {
    report['saveCurrentButton'] = 'FAIL (no save button on the bar)'
    return
  }
  report['saveCurrentButton'] = saveButton.disabled ? 'FAIL (disabled with a session open)' : 'ok'
  const paneCountBefore = panes().length
  press('ArrowDown', { altKey: true, shiftKey: true })
  // The save reads the panes, so wait for the new one to hold a terminal too.
  await waitFor(
    () =>
      panes().length === paneCountBefore + 1 &&
      panes().every((pane) => pane.querySelector('.terminal-host') !== null),
    8000,
  )

  saveButton.click()
  await waitForAsync(
    async () =>
      ((await api.loadSession(id)).spec?.columns.reduce((a, c) => a + c.panes.length, 0) ?? 0) === 2,
    8000,
  )

  const after = await api.listSessions()
  const added = after.map((s) => s.id).filter((seen) => !before.includes(seen))
  report['saveCurrentAddedNoFile'] =
    added.length === 0 ? 'ok' : `FAIL (also wrote ${added.join(',')})`

  const roundTrip = await api.loadSession(id)
  const paneCount = roundTrip.spec?.columns.reduce((a, c) => a + c.panes.length, 0) ?? 0
  report['saveCurrentWroteOwnFile'] =
    paneCount === 2 ? 'ok' : `FAIL (${String(paneCount)} panes in ${id}.yaml, expected 2)`
  // The display name is the file's, not something re-derived from the id.
  report['saveCurrentKeptName'] =
    roundTrip.spec?.name === displayName ? 'ok' : `FAIL (${String(roundTrip.spec?.name)})`

  const toast = document.querySelector<HTMLElement>('.toast:not([hidden])')
  report['saveCurrentToast'] = toast?.textContent?.includes(id) ?? false ? 'ok' : `FAIL (${String(toast?.textContent)})`

  /*
   * Undo. Switching away is not enough — the runtime stays alive, and the wheel
   * check that follows asserts that rows it passed never started a pty. So end
   * this one from its own row, then go back to the session the rest expects.
   */
  const seededRow = [...document.querySelectorAll<HTMLElement>('.sidebar__row')].find(
    (row) => row.querySelector('.sidebar__name')?.textContent === displayName,
  )
  seededRow?.querySelector<HTMLButtonElement>('.sidebar__close')?.click()
  // Re-query: ending a session re-renders the list, detaching the row above.
  const running = (): boolean =>
    [...document.querySelectorAll<HTMLElement>('.sidebar__row')].some(
      (row) =>
        row.querySelector('.sidebar__name')?.textContent === displayName &&
        row.querySelector('.sidebar__close') !== null,
    )
  await waitFor(() => !running(), 4000)
  const stillRunning = running()
  report['saveCurrentEnded'] = stillRunning ? 'FAIL (still running)' : 'ok'
  await openSession('verify')
}

/**
 * Creating a blank session, and the sidebar context menu.
 */
export async function checkNewSession(report: Report): Promise<void> {
  // The menu differs over a row versus empty space.
  const row = document.querySelector<HTMLElement>('.sidebar__list .sidebar__row')
  row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 140 }))
  await waitFor(() => menuItems().length > 0)
  const rowItems = menuItems()
  report['sidebarRowMenu'] = rowItems.map((b) => b.textContent).join(' / ') || 'none'
  report['sidebarRowMenuHasEnd'] =
    rowItems.some((b) => b.textContent?.includes(t.firstRun.endSession)) ? 'ok' : 'FAIL'
  report['sidebarRowMenuHasEdit'] =
    rowItems.some((b) => b.textContent?.includes(t.firstRun.editSessionFile)) ? 'ok' : 'FAIL'
  const deleteEntry = rowItems.find((b) => b.textContent === t.firstRun.deleteSession)
  report['sidebarRowMenuHasDelete'] = deleteEntry !== undefined ? 'ok' : 'FAIL'
  // Colour is the only warning before the dialog, so measure what is drawn
  // rather than trusting the class name.
  report['deleteEntryIsRed'] =
    deleteEntry !== undefined && getComputedStyle(deleteEntry).color === 'rgb(207, 122, 106)'
      ? 'ok'
      : `FAIL (${String(deleteEntry && getComputedStyle(deleteEntry).color)})`
  press('Escape')
  await waitFor(() => menuItems().length === 0)

  const list = document.querySelector<HTMLElement>('.sidebar__list')
  list?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 520 }))
  await waitFor(() => menuItems().length > 0)
  const emptyItems = menuItems()
  report['sidebarEmptyMenu'] = emptyItems.map((b) => b.textContent).join(' / ') || 'none'
  report['sidebarEmptyMenuHasNew'] =
    emptyItems.some((b) => b.textContent === t.firstRun.newSession) ? 'ok' : 'FAIL'
  press('Escape')
  await waitFor(() => menuItems().length === 0)

  // The header's + must be there even when the list is non-empty.
  const plus = [...document.querySelectorAll<HTMLButtonElement>('.sidebar__action')].find(
    (b) => b.title === t.sidebar.newSession,
  )
  if (plus === undefined) {
    report['newSessionButton'] = 'FAIL (no + button)'
    return
  }
  report['newSessionButton'] = 'ok'

  plus.click()
  await waitFor(saveDialogOpen)
  const field = document.querySelector<HTMLInputElement>('.save-session__input')
  const button = document.querySelector<HTMLButtonElement>('.save-session .button--accent')
  if (field === null || button === null) {
    report['newSessionOpens'] = 'FAIL (the dialog did not open)'
    return
  }
  report['newSessionOpens'] = 'ok'

  // An existing name must block creation rather than overwrite.
  field.value = 'verify'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await dialogChecked('verify')
  report['blankRefusesExistingName'] = button.disabled ? 'ok' : 'FAIL (overwrite was allowed)'

  const name = 'selfcheck-blank'
  field.value = name
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await dialogChecked(name)
  report['blankButtonSaysCreate'] =
    button.textContent === t.saveSession.create ? 'ok' : `FAIL (${String(button.textContent)})`

  button.click()
  // Creating opens it too, and the title is the last part of that to land.
  await waitForAsync(async () => (await api.listSessions()).some((s) => s.id === name), 8000)
  await waitFor(() => document.title.includes(name), 8000)

  const created = (await api.listSessions()).find((session) => session.id === name)
  report['blankSessionCreated'] =
    created === undefined ? 'FAIL (not in the list)' : `ok (${String(created.paneCount)} panes)`
  report['blankSessionReadable'] =
    created !== undefined && created.error === null ? 'ok' : `FAIL (${created?.error ?? 'none'})`
  // Opens immediately — picking it again would be a second step.
  report['blankSessionOpened'] = document.title.includes(name) ? 'ok' : `FAIL (${document.title})`
  await waitFor(() => visiblePanes().length === 1)
  report['blankSessionFillsCanvas'] = fillsCanvas()

  /*
   * Delete it again. Must ask first, and must disappear from the list —
   * checking only the file would miss a stale listing.
   */
  const madeRow = [...document.querySelectorAll<HTMLElement>('.sidebar__row')].find(
    (r) => r.dataset['sessionId'] === name,
  )
  madeRow?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 160 }))
  await waitFor(() => menuItems().length > 0)
  const deleteItem = menuItems().find((b) => b.textContent === t.firstRun.deleteSession)
  deleteItem?.click()
  await waitFor(() => {
    const layer = document.querySelector<HTMLElement>('.confirm-close')
    return layer !== null && !layer.hidden
  })

  const confirmLayer = document.querySelector<HTMLElement>('.confirm-close')
  report['deleteAsksFirst'] =
    confirmLayer !== null && !confirmLayer.hidden ? 'ok' : 'FAIL (deleted without asking)'

  const confirmButton = document.querySelector<HTMLButtonElement>('.confirm-close .button--danger')
  report['deleteGoesToTrash'] =
    confirmButton?.textContent === t.firstRun.deleteConfirm
      ? 'ok'
      : `FAIL (${String(confirmButton?.textContent)} — an irreversible delete)`
  confirmButton?.click()
  await waitForAsync(async () => !(await api.listSessions()).some((s) => s.id === name), 8000)

  report['sessionDeleted'] = (await api.listSessions()).some((s) => s.id === name)
    ? 'FAIL (still listed; not moved to the trash)'
    : 'ok'

  /*
   * A single-column session still needs a width handle. The vertical rule
   * (nothing to take space from below the last pane) does not apply across.
   */
  // Scope to the visible session, or hidden sessions' handles are counted too.
  const columnHandles = document.querySelectorAll(
    '.session-host:not([hidden]) .resize-handle--column',
  )
  report['soloColumnHasHandle'] =
    columnHandles.length >= 1 ? `ok (${String(columnHandles.length)})` : 'FAIL (no handle)'

  // Drag it: a handle that exists but does nothing is no handle.
  const handle = columnHandles[0] as HTMLElement | undefined
  const paneBefore = document.querySelector<HTMLElement>('.session-host:not([hidden]) .pane')
  const widthBefore = paneBefore?.getBoundingClientRect().width ?? 0
  /*
   * Widening stops at a column that already fills the viewport, which is where
   * a small screen (a CI runner's 1024x768) starts every column. Drag away from
   * whichever bound is closer, so the handle is exercised on any display.
   */
  // The session host is the canvas viewport the runtime measures its cap against.
  const canvasWidth = document.querySelector<HTMLElement>('.session-host:not([hidden])')?.clientWidth ?? 0
  const grow = widthBefore < maxColumnWidth(canvasWidth) - 40
  const dx = grow ? 160 : -160
  if (handle !== undefined) {
    const box = handle.getBoundingClientRect()
    const at = { clientX: box.left + box.width / 2, clientY: box.top + 100, bubbles: true }
    handle.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerId: 1 }))
    handle.dispatchEvent(
      new PointerEvent('pointermove', { ...at, clientX: at.clientX + dx, pointerId: 1 }),
    )
    handle.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerId: 1 }))
    // The column reflows on the release; wait for the width to come to rest.
    await holdsStill(
      () =>
        Math.round(
          document
            .querySelector<HTMLElement>('.session-host:not([hidden]) .pane')
            ?.getBoundingClientRect().width ?? 0,
        ),
      2000,
    )
  }
  const widthAfter =
    document.querySelector<HTMLElement>('.session-host:not([hidden]) .pane')?.getBoundingClientRect()
      .width ?? 0
  const moved = grow ? widthAfter > widthBefore + 40 : widthAfter < widthBefore - 40
  const trace = `${String(Math.round(widthBefore))} → ${String(Math.round(widthAfter))}px, ${grow ? 'wider' : 'narrower'}`
  report['soloColumnResizes'] = moved ? `ok (${trace})` : `FAIL (${trace})`
}

/**
 * Wheel over the sidebar: a preview highlight steps row by row, and the target
 * session opens only after the wheel rests. Rows passed through must stay cold.
 */
export async function checkWheelSessionSwitch(report: Report): Promise<void> {
  const name = 'selfcheck-wheel'
  const made = await api.createBlankSession(name, name, '~', 0)
  if (!made.ok) {
    report['wheelSwitchSetup'] = `FAIL (${made.error ?? 'create failed'})`
    return
  }
  refreshList()
  await waitFor(() => rowOf(name) !== undefined)

  // The dial only walks openable rows, so measure the distance on those.
  const openable = [...document.querySelectorAll<HTMLElement>('.sidebar__row')].filter(
    (r) => !r.classList.contains('sidebar__row--error'),
  )
  const from = openable.findIndex((r) => r.classList.contains('sidebar__row--current'))
  const to = openable.findIndex((r) => r.dataset['sessionId'] === name)
  if (from < 0 || to < 0 || from === to) {
    report['wheelSwitchSetup'] = `FAIL (rows ${String(from)} → ${String(to)})`
    return
  }
  report['wheelSwitchSetup'] = 'ok'

  const titleBefore = document.title
  const list = document.querySelector<HTMLElement>('.sidebar__list')
  // One mouse notch in line mode; sign follows where the target sits.
  const notch = (): void => {
    wheel(list, 0, to > from ? 3 : -3, 1)
  }

  notch()
  // Before the wheel rests nothing may open — the highlight is the only change.
  const preview = document.querySelector<HTMLElement>('.sidebar__row--preview')
  report['wheelPreviewAppears'] =
    preview !== null && getComputedStyle(preview).outlineStyle === 'solid'
      ? 'ok'
      : `FAIL (${preview === null ? 'no preview row' : getComputedStyle(preview).outlineStyle})`
  report['wheelHoldsUntilSettled'] =
    document.title === titleBefore ? 'ok' : `FAIL (opened at once: ${document.title})`

  // The remaining notches, in one burst so the settle timer cannot fire midway.
  for (let i = 1; i < Math.abs(to - from); i++) notch()

  const opened = await waitFor(() => document.title.includes(name))
  report['wheelOpensOnSettle'] = opened ? 'ok' : `FAIL (${document.title})`
  report['wheelPreviewCleared'] =
    document.querySelector('.sidebar__row--preview') === null ? 'ok' : 'FAIL (still highlighted)'

  // Cold means cold: only the origin and the target may hold a pty.
  const hot = [...document.querySelectorAll<HTMLElement>('.sidebar__row')]
    .filter((r) => r.querySelector('.sidebar__dot--on') !== null)
    .map((r) => r.dataset['sessionId'] ?? '?')
  report['wheelPassedRowsStayCold'] =
    hot.every((id) => id === name || rowOf(id)?.classList.contains('sidebar__row--current') === true || id === 'verify')
      ? 'ok'
      : `FAIL (running: ${hot.join(',')})`

  // Leave the group where it started.
  await openSession('verify')
  await api.deleteSession(name)
  refreshList()
  await waitFor(() => rowOf(name) === undefined)
}

/**
 * Coming back to a session that rang clears its mark.
 *
 * The pane that rang is often the one already focused there, so nothing is
 * clicked on the way in. A rule that waits for a focus change leaves the mark
 * up over a pane being looked at — only a live session switch shows it.
 */
export async function checkAttentionClearsOnReturn(report: Report): Promise<void> {
  const name = 'selfcheck-attention'
  const wants = (id: string): boolean =>
    rowOf(id)?.querySelector('.sidebar__dot--wants') != null

  // The pane to ring: focused here, and still focused when this comes back.
  const rang = focusedId()
  if (rang === undefined) {
    report['returnClearsSetup'] = 'FAIL (no focused pane to ring)'
    return
  }

  const made = await api.createBlankSession(name, name, '~', 0)
  if (!made.ok) {
    report['returnClearsSetup'] = `FAIL (${made.error ?? 'create failed'})`
    return
  }
  refreshList()
  await waitFor(() => rowOf(name) !== undefined)
  await openSession(name)
  if (!document.title.includes(name)) {
    report['returnClearsSetup'] = `FAIL (did not reach ${name}: ${document.title})`
    return
  }
  report['returnClearsSetup'] = 'ok'

  // Rung from off screen, which is the only way the mark can outlive a look.
  api.write(rang, `printf '\\033]777;notify;selfcheck;away\\a'\n`)
  const marked = await waitFor(() => wants('verify'))
  report['returnClearsMarked'] = marked ? 'ok' : 'FAIL (the session away never asked)'

  await openSession('verify')
  const cleared = await waitFor(() => !wants('verify'))
  report['returnClearsOnArrival'] = cleared ? 'ok' : 'FAIL (mark survived the return)'

  await api.deleteSession(name)
  refreshList()
  await waitFor(() => rowOf(name) === undefined)
}

/**
 * The sidebar's Notifications tab: a pane that rang while unwatched is listed,
 * counted in the tab, and one click on its row goes there.
 *
 * Nothing but the live app can show this. The queue is fed by the attention
 * stream and pruned by the sessions' own attention sets, and the tab strip has
 * to fit a 30px header beside the actions at whatever width the sidebar has.
 */
export async function checkNotificationQueue(report: Report): Promise<void> {
  const name = 'selfcheck-queue'
  const title = 'Queue check'
  const body = 'needs you now'
  const WANTS = resolveColor('var(--wants)')

  const aside = (): HTMLElement | null => document.querySelector<HTMLElement>('aside.sidebar')
  const tabs = (): HTMLButtonElement[] => [
    ...document.querySelectorAll<HTMLButtonElement>('.sidebar__tab'),
  ]
  const notifRows = (): HTMLElement[] => [
    ...document.querySelectorAll<HTMLElement>('.sidebar__notification'),
  ]
  const countOf = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('.sidebar__tab-count')
  /** The dot's painted fill, not its class: a class can be on and overridden. */
  const dotFill = (id: string): string | undefined => {
    const dot = rowOf(id)?.querySelector<HTMLElement>('.sidebar__dot')
    return dot == null ? undefined : getComputedStyle(dot).backgroundColor
  }
  const rect = (el: Element | null | undefined): DOMRect | undefined => el?.getBoundingClientRect()
  /** Sub-pixel layout rounds; a real overflow is a pixel or more. */
  const EPS = 0.5

  const rang = focusedId()
  if (rang === undefined) {
    report['notifyQueueSetup'] = 'FAIL (no focused pane to ring)'
    return
  }
  const made = await api.createBlankSession(name, name, '~', 0)
  if (!made.ok) {
    report['notifyQueueSetup'] = `FAIL (${made.error ?? 'create failed'})`
    return
  }
  refreshList()
  await waitFor(() => rowOf(name) !== undefined)

  /*
   * A second unwatched pane, without making one: a session that already runs
   * (the dot is lit), visited once to learn which pane it has focused. That pane
   * is the one it looks at on return, so arriving there puts its mark down again.
   * Panes cannot be told apart by session from the DOM of a hidden host alone.
   */
  let bell: { id: string; label: string; pane: string } | undefined
  const other = [...document.querySelectorAll<HTMLElement>('.sidebar__row')].find(
    (r) =>
      r.dataset['sessionId'] !== 'verify' &&
      r.dataset['sessionId'] !== name &&
      r.querySelector('.sidebar__dot--on') !== null &&
      r.querySelector('.sidebar__dot--wants') === null,
  )
  const otherLabel = other?.querySelector('.sidebar__name')?.textContent
  if (other?.dataset['sessionId'] !== undefined && otherLabel != null && otherLabel !== '') {
    await openSession(otherLabel)
    // Scoped to the host on screen: a hidden session's focused pane comes first in the DOM.
    const pane = document.querySelector<HTMLElement>(
      '.session-host:not([hidden]) .pane--focused',
    )?.dataset['paneId']
    if (pane !== undefined && document.title.includes(otherLabel)) {
      bell = { id: other.dataset['sessionId'], label: otherLabel, pane }
    }
  }
  await openSession(name)

  /** Back to how the group found things, whatever happened above. */
  const leave = async (): Promise<void> => {
    tabs()[0]?.click()
    // The bell mark is cleared by looking, as a user would.
    if (bell !== undefined && rowOf(bell.id)?.querySelector('.sidebar__dot--wants') != null) {
      await openSession(bell.label)
      await waitFor(() => rowOf(bell.id)?.querySelector('.sidebar__dot--wants') == null)
    }
    await openSession('verify')
    await api.deleteSession(name)
    refreshList()
    await waitFor(() => rowOf(name) === undefined)
    const sessionsTabOn = tabs()[0]?.getAttribute('aria-selected') === 'true'
    const gone = rowOf(name) === undefined && notifRows().length === 0
    report['notifyQueueLeftAsFound'] =
      sessionsTabOn && gone && document.title.includes('verify')
        ? 'ok'
        : `FAIL (sessions tab ${String(sessionsTabOn)}, temporary session gone ${String(rowOf(name) === undefined)}, rows ${String(notifRows().length)}, title ${document.title})`
  }

  if (!document.title.includes(name)) {
    report['notifyQueueSetup'] = `FAIL (did not reach ${name}: ${document.title})`
    await leave()
    return
  }
  report['notifyQueueSetup'] = 'ok'

  // From off screen, on the pane that was focused: the only kind that is queued.
  api.write(rang, `printf '\\033]777;notify;${title};${body}\\a'\n`)
  const counted = await waitFor(() => countOf()?.textContent === '1')
  const count = countOf()
  const fill = count === null ? '' : getComputedStyle(count).color
  report['notifyQueueCount'] = !counted
    ? `FAIL (tab count reads "${count?.textContent ?? 'no count element'}", wanted "1")`
    : fill !== WANTS
      ? `FAIL (count colour ${fill}, --wants is ${WANTS})`
      : 'ok'

  // The header at the sidebar's current width.
  const side = rect(aside())
  const header = rect(document.querySelector('.sidebar__header'))
  const strip = rect(document.querySelector('.sidebar__tabs'))
  const actions = rect(document.querySelector('.sidebar__actions'))
  const lastTab = rect(tabs()[1])
  const countBox = rect(countOf())
  if (side === undefined || side.width === 0 || header === undefined || strip === undefined || actions === undefined || countBox === undefined) {
    report['notifyQueueHeader'] = 'skipped (sidebar not laid out: closed or collapsed)'
  } else {
    const problems: string[] = []
    if (Math.abs(header.height - 30) > EPS) problems.push(`header is ${String(header.height)}px tall, wanted 30`)
    if (strip.right > actions.left + EPS) {
      problems.push(`tab strip ends at ${String(strip.right)}, past the actions at ${String(actions.left)}`)
    }
    if (lastTab !== undefined && lastTab.right > actions.left + EPS) {
      problems.push(`notifications tab ends at ${String(lastTab.right)}, past the actions at ${String(actions.left)}`)
    }
    if (countBox.width <= 0) problems.push('count has no width')
    if (countBox.left < header.left - EPS || countBox.right > header.right + EPS) {
      problems.push(`count spans ${String(countBox.left)}..${String(countBox.right)}, header ${String(header.left)}..${String(header.right)}`)
    }
    if (countBox.right > actions.left + EPS) {
      problems.push(`count ends at ${String(countBox.right)}, under the actions at ${String(actions.left)}`)
    }
    const labels = [...document.querySelectorAll<HTMLElement>('.sidebar__tab-label')]
    const cut = (i: number): string => String((labels[i]?.scrollWidth ?? 0) > (labels[i]?.clientWidth ?? 0))
    report['notifyQueueHeader'] =
      problems.length === 0
        ? `ok (${String(Math.round(side.width))}px, labels truncated: sessions=${cut(0)} notifications=${cut(1)})`
        : `FAIL (${problems.join('; ')})`
  }

  // The tab, then what it lists.
  tabs()[1]?.click()
  await waitFor(() => notifRows().length > 0)
  const rows = notifRows()
  const row = rows[0]
  const list = document.querySelector<HTMLElement>('.sidebar__list')
  const rowBox = rect(row)
  const listBox = rect(list)
  if (side === undefined || side.width === 0) {
    report['notifyQueueRow'] = 'skipped (sidebar not laid out: closed or collapsed)'
  } else if (rows.length !== 1 || row === undefined || rowBox === undefined) {
    report['notifyQueueRow'] = `FAIL (${String(rows.length)} rows, wanted 1)`
  } else {
    const said = row.textContent ?? ''
    const sideNow = rect(aside()) ?? side
    const problems: string[] = []
    if (rowBox.width <= 0 || rowBox.height <= 0) problems.push(`row is ${String(rowBox.width)}x${String(rowBox.height)}`)
    if (rowBox.left < sideNow.left - EPS || rowBox.right > sideNow.right + EPS) {
      problems.push(`row spans ${String(rowBox.left)}..${String(rowBox.right)}, sidebar ${String(sideNow.left)}..${String(sideNow.right)}`)
    }
    for (const want of [title, body, 'verify']) {
      if (!said.includes(want)) problems.push(`row lacks "${want}": "${said}"`)
    }
    const listHidden =
      list === null ||
      getComputedStyle(list).display === 'none' ||
      (listBox !== undefined && (listBox.width === 0 || listBox.height === 0))
    if (!listHidden) problems.push('sessions list still takes space')
    report['notifyQueueRow'] = problems.length === 0 ? 'ok' : `FAIL (${problems.join('; ')})`
  }

  // A bell marks a dot and nothing else.
  if (bell === undefined) {
    report['notifyQueueBellSkipsQueue'] = 'skipped (no second unwatched pane)'
  } else {
    api.write(bell.pane, `printf '\\a'\n`)
    const marked = await waitFor(() => rowOf(bell.id)?.querySelector('.sidebar__dot--wants') != null)
    // The queue is fed in the same call that marks the dot, so the mark is the last word.
    report['notifyQueueBellSkipsQueue'] = !marked
      ? `FAIL (the bell never marked ${bell.label})`
      : notifRows().length === 1 && countOf()?.textContent === '1'
        ? 'ok'
        : `FAIL (${String(notifRows().length)} rows, count "${countOf()?.textContent ?? ''}", wanted 1)`
  }

  // One click goes to the pane, and its row leaves.
  const dotBefore = dotFill('verify')
  row?.click()
  const arrived = await waitFor(() => document.title.includes('verify'), 8000)
  const cleared = await waitFor(() => notifRows().length === 0, 8000)
  tabs()[0]?.click()
  const dotAfter = dotFill('verify')
  const clickProblems: string[] = []
  if (dotBefore !== WANTS) clickProblems.push(`the session's dot was ${dotBefore ?? 'missing'} before the click, not --wants`)
  if (!arrived) clickProblems.push(`still on ${document.title}`)
  if (!cleared) clickProblems.push(`${String(notifRows().length)} rows left`)
  if (countOf()?.textContent !== '') clickProblems.push(`count reads "${countOf()?.textContent ?? 'no element'}"`)
  if (dotAfter === WANTS) clickProblems.push('the session dot is still --wants')
  report['notifyQueueClickGoes'] = clickProblems.length === 0 ? 'ok' : `FAIL (${clickProblems.join('; ')})`

  await leave()
}

/**
 * Alt+Shift+< / > steps between the sessions that are running.
 *
 * The ring is built from live runtimes, which no unit test can see: a check
 * against the sidebar alone would pass while the key opened a cold session.
 */
export async function checkSessionStepShortcut(report: Report): Promise<void> {
  const name = 'selfcheck-step'
  const made = await api.createBlankSession(name, name, '~', 0)
  if (!made.ok) {
    report['stepSetup'] = `FAIL (${made.error ?? 'create failed'})`
    return
  }
  const running = (): string[] =>
    [...document.querySelectorAll<HTMLElement>('.sidebar__row')]
      .filter((r) => r.querySelector('.sidebar__dot--on') !== null)
      .map((r) => r.dataset['sessionId'] ?? '?')

  refreshList()
  await waitFor(() => rowOf(name) !== undefined)
  // Two running sessions is the smallest ring the step can be seen in.
  await openSession(name)
  if (!document.title.includes(name)) {
    report['stepSetup'] = `FAIL (did not reach ${name}: ${document.title})`
    return
  }
  const before = running().length
  report['stepSetup'] = before >= 2 ? 'ok' : `FAIL (only ${before} running)`

  press('Comma', { altKey: true, shiftKey: true })
  report['stepPrevMoves'] =
    (await waitFor(() => !document.title.includes(name))) ? 'ok' : `FAIL (${document.title})`

  press('Period', { altKey: true, shiftKey: true })
  report['stepNextWrapsBack'] =
    (await waitFor(() => document.title.includes(name))) ? 'ok' : `FAIL (${document.title})`

  // The ring must hold only what was already live — the key spawns nothing.
  report['stepSpawnsNothing'] =
    running().length === before ? 'ok' : `FAIL (${before} → ${running().length} running)`

  await openSession('verify')
  await api.deleteSession(name)
  refreshList()
  await waitFor(() => rowOf(name) === undefined)
}

/** Copy-on-select needs feedback — the clipboard is invisible until pasted. */
export async function checkCopyToast(report: Report): Promise<void> {
  const hostEl = focusedHost()
  const term = termOf(hostEl)
  if (term === undefined || hostEl === null) {
    report['copyToast'] = 'FAIL (could not reach the terminal)'
    return
  }
  term.selectAll()
  hostEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  await waitFor(() => document.querySelector<HTMLElement>('.toast')?.hidden === false, 2000)
  const toast = document.querySelector<HTMLElement>('.toast')
  // The toast copy up to the character count, which cannot be predicted here.
  const copiedPrefix = t.firstRun.copied('\u0000').split('\u0000')[0] ?? ''
  report['copyToast'] =
    toast !== null && !toast.hidden && (toast.textContent ?? '').includes(copiedPrefix)
      ? 'ok'
      : `FAIL (${String(toast?.hidden)} ${String(toast?.textContent)})`

  // Must fade; a permanent toast is scenery, not a notice.
  await waitFor(() => toast?.hidden === true, 4000)
  report['copyToastFades'] = toast?.hidden === true ? 'ok' : 'FAIL (never fades)'
}

/**
 * After a resize, does the pty agree with the terminal?
 *
 * If they diverge the screen stays broken: the program inside draws at the old
 * width and has no way to know it is wrong. Ask stty rather than trusting what
 * the app believes it sent.
 */
export async function checkResizeSync(report: Report): Promise<void> {
  const paneId = focusedId()
  const term = termOf(focusedHost())
  if (paneId === undefined || term === undefined) {
    report['resizeSync'] = 'FAIL (missing prerequisites for this check)'
    return
  }

  /** Ask stty directly. Comes back as one "rows cols" line. */
  const askPty = async (): Promise<string> => {
    term.clear()
    api.write(paneId, 'stty size\n')
    let answer = '?'
    // The reply is what is being waited for, so read it as it arrives.
    await waitFor(() => {
      term.selectAll()
      const match = /(\d+)\s+(\d+)/.exec(term.getSelection().replace('stty size', ''))
      if (match === null) return false
      answer = `${match[1]}x${match[2]}`
      return true
    }, 6000)
    return answer
  }

  /*
   * xterm 6 draws its own scrollbar from the overviewRuler option, so neither
   * ::-webkit-scrollbar rules nor the token reach it. Measure the rendered
   * width and compare it with the token the option is meant to mirror.
   */
  const slider = document.querySelector<HTMLElement>(
    '.pane--focused .xterm-scrollable-element > .scrollbar.vertical',
  )
  const sliderWidth = slider === null ? -1 : Math.round(slider.getBoundingClientRect().width)
  const wanted = Math.round(
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scroll-w')),
  )
  report['terminalScrollbarWidth'] = slider === null ? 'none' : `${String(sliderWidth)}px`
  report['terminalScrollbarIsThin'] =
    slider === null
      ? 'FAIL (no scrollbar)'
      : sliderWidth === wanted
        ? 'ok'
        : `FAIL (${String(sliderWidth)}px — --scroll-w is ${String(wanted)}px)`

  const before = await askPty()
  report['ptySizeBeforeResize'] = before

  /*
   * Resize by key, not by drag: the first handle isn't necessarily the focused
   * pane's column. Repeated presses also exercise the intermediate values.
   */
  for (let i = 0; i < 6; i++) {
    press('ArrowLeft', { ctrlKey: true, altKey: true })
    // Input pacing: the point is to exercise the intermediate widths.
    await sleep(30)
  }

  // The resize is debounced, so wait for the terminal's own size to settle.
  await holdsStill(() => term.cols, 3000)

  const termSize = `${String(term.rows)}x${String(term.cols)}`
  const after = await askPty()
  report['termSizeAfterResize'] = termSize
  report['ptySizeAfterResize'] = after
  report['resizeSync'] =
    after === termSize
      ? 'ok'
      : `FAIL (terminal ${termSize}, pty ${after} — the screen stays broken like this)`
  report['resizeActuallyChanged'] = after !== before ? 'ok' : `FAIL (size unchanged: ${before})`
}

/**
 * Does closing ask first? Without detach, closing kills every process inside,
 * so the request must surface a dialog listing what would die.
 */
export async function checkCloseGuard(report: Report): Promise<void> {
  // Same path as the window button: main blocks and asks the renderer.
  api.window.close()
  await waitFor(() => {
    const asking = document.querySelector<HTMLElement>('.confirm-close')
    return asking !== null && !asking.hidden
  }, 6000)

  const layer = document.querySelector<HTMLElement>('.confirm-close')
  if (layer === null || layer.hidden) {
    report['closeGuard'] = 'FAIL (closed without asking despite a running session)'
    return
  }
  report['closeGuard'] = 'ok'

  const rows = [...document.querySelectorAll<HTMLElement>('.confirm-close__row')]
  report['closeGuardLists'] =
    rows.length > 0
      ? `ok (${rows.map((r) => r.textContent?.trim()).join(' / ')})`
      : 'FAIL (does not say what would be lost)'

  // The irreversible option must not be the default; focus belongs on cancel.
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.confirm-close .button')]
  report['closeGuardDefaultsToCancel'] =
    document.activeElement === buttons[0] ? 'ok' : `FAIL (${String(document.activeElement?.textContent)})`
  report['closeGuardDangerButton'] =
    buttons[1]?.classList.contains('button--danger') === true ? 'ok' : 'FAIL'

  await capture(report, 'confirm-close')

  // Cancelling leaves the app running.
  press('Escape')
  await waitFor(() => layer.hidden === true)
  report['closeGuardCancels'] =
    layer.hidden && visiblePanes().length > 0 ? 'ok' : 'FAIL (state is wrong after cancelling)'
}

/**
 * Holding the session-jump key.
 *
 * A held Alt+N repeats about thirty times a second, and each repeat switches
 * session. A WebGL context belongs to the page, not to a session, so the total
 * has to stay under the cap however fast the switching goes — past it the
 * browser force-releases the oldest context and that pane is left blank.
 *
 * Sessions keep their contexts across a switch rather than handing them back:
 * rebuilding one costs tens of milliseconds per pane, which is what made
 * stepping between sessions stutter.
 */
export async function checkHeldSessionJump(report: Report): Promise<void> {
  const withRenderer = (root: ParentNode): number =>
    [...root.querySelectorAll<HTMLElement>('.terminal-host')].filter(
      (host) => host.querySelector(RENDERER_CANVAS) !== null,
    ).length

  /*
   * A context the browser takes back fires webglcontextlost on a canvas that is
   * still in the document; the ones the app gives back fire it on canvases
   * already removed. Only the first kind leaves a pane white.
   */
  let liveLost = 0
  const onLost = (event: Event): void => {
    if ((event.target as HTMLCanvasElement).isConnected) liveLost++
  }
  document.addEventListener('webglcontextlost', onLost, true)

  // Faster than any autorepeat, so the check does not depend on the setting.
  for (let i = 0; i < 61; i++) {
    press('Digit2', { altKey: true })
    // Input pacing: this is the autorepeat being reproduced, not a wait.
    await sleep(25)
  }

  // The session left on screen must end up drawn, not blank.
  const shown = document.querySelector<HTMLElement>('.session-host:not([hidden])')
  await waitFor(() => shown !== null && withRenderer(shown) > 0)
  report['heldJumpVisibleSessionDrawn'] =
    shown !== null && withRenderer(shown) > 0 ? 'ok' : 'FAIL (no pane holds a renderer)'

  const hidden = [...document.querySelectorAll<HTMLElement>('.session-host[hidden]')]
  const held = hidden.reduce((sum, host) => sum + withRenderer(host), 0)
  report['heldJumpHiddenSessionContexts'] =
    held > 0 ? `ok (${held} kept)` : 'FAIL (the session left gave up every context)'

  // The count that matters is the page's, not one session's.
  const pageContexts = withRenderer(document)
  report['heldJumpPageContexts'] =
    pageContexts <= MAX_WEBGL_CONTEXTS
      ? `ok (${pageContexts})`
      : `FAIL ${pageContexts} > ${MAX_WEBGL_CONTEXTS} across the page`

  // Give the browser a moment to evict, if it is going to.
  await sleep(300)
  document.removeEventListener('webglcontextlost', onLost, true)
  report['heldJumpLiveContextsKept'] =
    liveLost === 0 ? 'ok' : `FAIL (${liveLost} live contexts taken back by the browser)`

  // Leave one session running: the checks after this one count what is open.
  const spare = [...document.querySelectorAll<HTMLButtonElement>('.sidebar__close')].find(
    (button) => button.closest('.sidebar__row')?.textContent?.includes('spare') === true,
  )
  spare?.click()
  await waitFor(() => document.querySelectorAll('.session-host').length === 1)
  report['heldJumpSpareEnded'] =
    document.querySelectorAll('.session-host').length === 1 ? 'ok' : 'FAIL (spare still running)'
}

/**
 * Dragging a row past its neighbour reorders the list.
 *
 * `onReorder` is a dom test in isolation, but only the running app proves the
 * round trip through main's order file and back into a redrawn list agree on
 * where the row landed.
 */
export async function checkSidebarReorder(report: Report): Promise<void> {
  const rows = (): HTMLElement[] => [
    ...document.querySelectorAll<HTMLElement>('.sidebar__list .sidebar__row'),
  ]
  const idsOf = (list: readonly HTMLElement[]): string[] =>
    list.map((r) => r.dataset['sessionId'] ?? '?')

  const start = rows()
  if (start.length < 2) {
    report['sidebarReorder'] = 'skipped (needs two sessions)'
    return
  }
  const originalOrder = idsOf(start)

  // Swaps the first two rows by dragging row 0 past row 1's middle — the same
  // pointer sequence the dom test uses, dispatched on `.sidebar__row` so it
  // bubbles to the list's listeners.
  const dragFirstPastSecond = (): void => {
    const current = rows()
    const first = current[0]
    const second = current[1]
    if (first === undefined || second === undefined) return
    const firstBox = first.getBoundingClientRect()
    const secondBox = second.getBoundingClientRect()
    const startY = firstBox.top + firstBox.height / 2
    const targetY = secondBox.top + secondBox.height / 2 + 1
    const at = (y: number): PointerEventInit => ({
      clientX: firstBox.left + 10,
      clientY: y,
      bubbles: true,
      cancelable: true,
      pointerId: 1,
    })
    first.dispatchEvent(new PointerEvent('pointerdown', at(startY)))
    first.dispatchEvent(new PointerEvent('pointermove', at(targetY)))
    first.dispatchEvent(new PointerEvent('pointerup', at(targetY)))
  }

  dragFirstPastSecond()
  const swapped = await waitFor(() => {
    const now = idsOf(rows())
    return now[0] === originalOrder[1] && now[1] === originalOrder[0]
  })
  report['sidebarReorderSwaps'] = swapped
    ? 'ok'
    : `FAIL (${originalOrder.slice(0, 2).join(',')} -> ${idsOf(rows()).slice(0, 2).join(',')})`

  // Leave the list as it was found: the same drag again swaps the pair back.
  dragFirstPastSecond()
  const restored = await waitFor(() => {
    const now = idsOf(rows())
    return now[0] === originalOrder[0] && now[1] === originalOrder[1]
  })
  report['sidebarReorderRestores'] = restored
    ? 'ok'
    : `FAIL (left as ${idsOf(rows()).slice(0, 2).join(',')}, expected ${originalOrder.slice(0, 2).join(',')})`
}

/**
 * A row dropped anywhere in the open archive lands on the slot under the
 * pointer, and archived rows reorder by drag.
 *
 * The dom tests hand every row its box; only the running app has the dock's
 * real geometry, and the round trip through main's order file.
 */
export async function checkArchiveDock(report: Report): Promise<void> {
  const ids = ['selfcheck-shelf-a', 'selfcheck-shelf-b', 'selfcheck-shelf-c'] as const
  const [a, b, c] = ids
  for (const id of ids) await api.createBlankSession(id, id, '~', 0)
  refreshList()
  const listed = await waitFor(() => ids.every((id) => rowOf(id) !== undefined), 5000)
  if (!listed) {
    report['archiveDock'] = 'FAIL (could not make the sessions to archive)'
    for (const id of ids) await api.deleteSession(id)
    refreshList()
    return
  }

  const dockIds = (): string[] =>
    [...document.querySelectorAll<HTMLElement>('.sidebar__dock-list .sidebar__row')].map(
      (r) => r.dataset['sessionId'] ?? '?',
    )
  const box = (selector: string): DOMRect | undefined =>
    document.querySelector<HTMLElement>(selector)?.getBoundingClientRect()
  const midOf = (id: string): number => {
    const rect = rowOf(id)?.getBoundingClientRect()
    return rect === undefined ? 0 : rect.top + rect.height / 2
  }
  /** Press a row, travel far enough to become a drag, then go where `to` says and let go. */
  const dragRow = (id: string, to: () => number): void => {
    const row = rowOf(id)
    if (row === undefined) return
    const rect = row.getBoundingClientRect()
    const startY = rect.top + rect.height / 2
    const at = (y: number): PointerEventInit => ({
      clientX: rect.left + 10,
      clientY: y,
      bubbles: true,
      cancelable: true,
      pointerId: 1,
    })
    row.dispatchEvent(new PointerEvent('pointerdown', at(startY)))
    // The first move is what puts an empty archive's dock on screen to aim at.
    row.dispatchEvent(new PointerEvent('pointermove', at(startY + 8)))
    const targetY = to()
    row.dispatchEvent(new PointerEvent('pointermove', at(targetY)))
    row.dispatchEvent(new PointerEvent('pointerup', at(targetY)))
  }

  // Closed, the dock is its header: dropping there archives.
  dragRow(a, () => {
    const header = box('.sidebar__dock-header')
    return header === undefined ? 0 : header.top + header.height / 2
  })
  const shelved = await waitFor(() => dockIds().includes(a))
  report['archiveDropOnHeader'] = shelved ? 'ok' : `FAIL (dock holds ${dockIds().join(',')})`

  document.querySelector<HTMLElement>('.sidebar__dock-header')?.click()
  const opened = await waitFor(
    () =>
      document.querySelector('.sidebar__dock--settled') !== null &&
      (rowOf(a)?.getBoundingClientRect().height ?? 0) > 0,
  )
  // The dock opens on a transition, and an occluded window produces no frames
  // to run it: its rows then have no place on screen to aim between.
  if (!opened) {
    report['archiveDockSlots'] = 'skipped: the dock never finished opening (no frames arriving)'
    await api.restoreSession(a)
    for (const id of ids) await api.deleteSession(id)
    refreshList()
    await waitFor(() => ids.every((id) => rowOf(id) === undefined), 5000)
    return
  }

  // Open, the rows are part of it: above the header, on the upper half of the one row.
  const header = box('.sidebar__dock-header')
  const upperHalf = (rowOf(a)?.getBoundingClientRect().top ?? 0) + 2
  const aboveHeader = header !== undefined && upperHalf < header.top
  dragRow(b, () => upperHalf)
  const inFront = await waitFor(() => dockIds().join(',') === `${b},${a}`)
  report['archiveDropInsideDock'] =
    inFront && aboveHeader ? 'ok' : `FAIL (dock holds ${dockIds().join(',')}, above header ${String(aboveHeader)})`

  // Past the last row's middle is the last slot.
  dragRow(c, () => midOf(a) + 2)
  const atEnd = await waitFor(() => dockIds().join(',') === `${b},${a},${c}`)
  report['archiveDropAtSlot'] = atEnd ? 'ok' : `FAIL (dock holds ${dockIds().join(',')})`

  // The first archived row past the second one's middle: the two swap.
  dragRow(b, () => midOf(a) + 2)
  const reordered = await waitFor(() => dockIds().join(',') === `${a},${b},${c}`)
  report['archiveReorders'] = reordered ? 'ok' : `FAIL (dock holds ${dockIds().join(',')})`
  // The file is the order: the redrawn dock and main's listing must agree.
  const filed = (await api.listSessions()).filter((s) => s.archived).map((s) => s.id)
  report['archiveOrderKept'] =
    filed.join(',') === dockIds().join(',') ? 'ok' : `FAIL (listed ${filed.join(',')}, drawn ${dockIds().join(',')})`

  // The handle takes the place of a session row's dot, and shows only under the pointer.
  const handle = rowOf(a)?.querySelector<SVGElement>('.sidebar__handle')
  const name = rowOf(a)?.querySelector<HTMLElement>('.sidebar__name')
  const handleBox = handle?.getBoundingClientRect()
  const nameBox = name?.getBoundingClientRect()
  report['archiveHandleBesideName'] =
    handleBox !== undefined && nameBox !== undefined && handleBox.width > 0 && handleBox.right <= nameBox.left
      ? 'ok'
      : `FAIL (handle ${String(handleBox?.left)}..${String(handleBox?.right)}, name from ${String(nameBox?.left)})`
  report['archiveHandleHiddenAtRest'] =
    handle != null && getComputedStyle(handle).opacity === '0'
      ? 'ok'
      : `FAIL (opacity ${handle == null ? 'none' : getComputedStyle(handle).opacity})`

  // Leave nothing behind: an emptied archive takes its dock away with it.
  for (const id of ids) {
    await api.restoreSession(id)
    await api.deleteSession(id)
  }
  refreshList()
  const cleared = await waitFor(
    () => ids.every((id) => rowOf(id) === undefined) && document.querySelector('.sidebar__dock') === null,
    5000,
  )
  report['archiveDockLeft'] = cleared ? 'ok' : 'FAIL (rows or the dock stayed)'
}

/**
 * A session whose file failed to parse still shows a row, its open button
 * disabled so a click can't spawn a pty for it — but the row underneath must
 * still take a drag. That relies on `.sidebar__open:disabled { pointer-events:
 * none }` in `app.css`, a rule happy-dom never applies (it loads no
 * stylesheet), so the dom test can't see whether the press actually falls
 * through to the row. Only the real browser can.
 */
export async function checkErrorRowStaysDraggable(report: Report): Promise<void> {
  const errorRow = document.querySelector<HTMLElement>('.sidebar__row--error')
  if (errorRow === null) {
    report['sidebarErrorRowDraggable'] = 'skipped (no broken session present to check)'
    return
  }
  const open = errorRow.querySelector<HTMLButtonElement>('.sidebar__open')
  if (open === null) {
    report['sidebarErrorRowDraggable'] = 'FAIL (error row has no open button)'
    return
  }
  report['sidebarErrorRowDisabled'] = open.disabled ? 'ok' : 'FAIL (not disabled)'
  const style = getComputedStyle(open)
  report['sidebarErrorRowDraggable'] =
    style.pointerEvents === 'none'
      ? 'ok'
      : `FAIL (pointer-events: ${style.pointerEvents} — the press would hit the button, not the row)`
}

/**
 * A narrowed list spends its width on names, not on the Alt+N chord.
 *
 * The chord is hover-only, and it used to hold its column even while invisible:
 * names ellipsised against a gap showing nothing. It is out of flow now, and a
 * row with nothing left beside the count drops it. Only real layout can show
 * this — happy-dom measures every box as zero.
 */
export async function checkSidebarNarrowName(report: Report): Promise<void> {
  const row = document.querySelector<HTMLElement>('.sidebar__list .sidebar__row')
  const grip = document.querySelector<HTMLElement>('.sidebar__grip')
  const open = row?.querySelector<HTMLElement>('.sidebar__open') ?? null
  const name = row?.querySelector<HTMLElement>('.sidebar__name') ?? null
  const meta = row?.querySelector<HTMLElement>('.sidebar__meta') ?? null
  const hint = row?.querySelector<HTMLElement>('.sidebar__hint') ?? null
  if (row === null || grip === null || open === null || name === null || meta === null) {
    report['sidebarNarrowName'] = 'skipped (list not on screen)'
    return
  }
  if (hint === null) {
    report['sidebarNarrowName'] = 'skipped (row carries no chord)'
    return
  }

  const wideBefore = open.getBoundingClientRect().width
  const nameBefore = name.textContent ?? ''
  name.textContent = 'a session name far too long for a narrow list'

  const dragGrip = (dx: number): void => {
    const box = grip.getBoundingClientRect()
    const at = (x: number): PointerEventInit => ({
      clientX: x,
      clientY: box.top + box.height / 2,
      bubbles: true,
      cancelable: true,
      pointerId: 1,
    })
    const from = box.left + box.width / 2
    grip.dispatchEvent(new PointerEvent('pointerdown', at(from)))
    grip.dispatchEvent(new PointerEvent('pointermove', at(from + dx)))
    grip.dispatchEvent(new PointerEvent('pointerup', at(from + dx)))
  }

  dragGrip(-400)
  const narrowed = await waitFor(() => open.getBoundingClientRect().width < wideBefore - 20)
  if (!narrowed) {
    name.textContent = nameBefore
    report['sidebarNarrowName'] = 'skipped (the width grip did not take the drag)'
    return
  }
  const box = open.getBoundingClientRect()
  const edge = box.right - Number.parseFloat(getComputedStyle(open).paddingRight)
  const slack = edge - meta.getBoundingClientRect().right
  report['sidebarNarrowNameUsesRow'] =
    slack < 12
      ? `ok (${slack.toFixed(0)}px spare)`
      : `FAIL (${slack.toFixed(0)}px held for the chord)`
  report['sidebarNarrowHintDropped'] = row.classList.contains('sidebar__row--tight')
    ? 'ok'
    : 'FAIL (chord kept beside a name with no room for it)'
  await capture(report, 'sidebar-narrow')

  // Leave the list at the width it was found at, and with its own name back.
  // The name goes back first: the widening drag is what re-measures the row.
  // Back by the exact amount, not by 400: the narrowing drag hit the minimum,
  // and the same distance out again would leave the list wider than it was.
  name.textContent = nameBefore
  dragGrip(wideBefore - box.width)
  await waitFor(() => open.getBoundingClientRect().width > wideBefore - 2)
  report['sidebarWideHintKept'] =
    row.classList.contains('sidebar__row--tight') === false
      ? 'ok'
      : 'FAIL (chord still dropped at full width)'
}

/**
 * The herdr keys, end to end: Alt+H types the attach line, Alt+Shift+H stops
 * the session. Needs the binary; a machine without it reports skipped.
 */
export async function checkHerdrKeys(report: Report): Promise<void> {
  // The session on screen: a hidden host earlier in the document keeps its own focused pane.
  const id = document.querySelector<HTMLElement>('.session-host:not([hidden]) .pane--focused')?.dataset['paneId']
  if (id === undefined) {
    report['herdrKeys'] = 'skipped: no focused pane'
    return
  }
  const foreground = async (): Promise<string | null> => (await api.foregroundCommands([id]))[id] ?? null
  if ((await foreground()) !== null) {
    report['herdrKeys'] = 'skipped: the focused pane is busy'
    return
  }
  // A stop on a pane that runs nothing tells us whether the binary is there at all.
  const probe = await api.herdrStop(id)
  if (!probe.ok && probe.reason === 'no-herdr') {
    report['herdrKeys'] = 'skipped (herdr is not installed here)'
    return
  }
  report['herdrStopRefusesIdle'] = !probe.ok && probe.reason === 'not-herdr' ? 'ok' : `FAIL (${JSON.stringify(probe)})`

  const inHerdr = async (): Promise<boolean> => (await foreground())?.includes('herdr') === true
  press('KeyH', { altKey: true })
  const attached = await waitForAsync(inHerdr, 8000)
  report['herdrWrapAttaches'] = attached ? 'ok' : `FAIL (foreground: ${String(await foreground())})`

  // Stop whatever the verdict: a late attach would leave herdr in the pane the next check types into.
  const seen = attached || (await waitForAsync(inHerdr, 4000))
  press('KeyH', { altKey: true, shiftKey: true })
  const idle = await waitForAsync(async () => (await foreground()) === null, 8000)
  if (!seen && idle) {
    report['herdrStopReturnsToShell'] = 'skipped (nothing attached to stop)'
    return
  }
  report['herdrStopReturnsToShell'] = idle ? 'ok' : `FAIL (foreground: ${String(await foreground())})`
  report['herdrKeysNote'] = 'a stopped herdr session named after this session remains in herdr session list'
}
