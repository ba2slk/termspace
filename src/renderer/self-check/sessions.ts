import { api } from '../api'
import { t } from '../i18n'
import { maxColumnWidth } from '../layout-geometry'
import { MAX_WEBGL_CONTEXTS } from '../renderer-budget'
import {
  capture,
  focusedId,
  openSession,
  panes,
  press,
  type Report,
  sleep,
  visiblePanes,
  waitFor,
} from './harness'

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
  await sleep(200)
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
  const hostEl = document.querySelector<HTMLElement>('.pane--focused .terminal-host')
  const term = (hostEl as unknown as
    | { __term?: { selectAll(): void; getSelection(): string } }
    | null)?.__term
  if (paneId === undefined || term === undefined) {
    report['shellHook'] = 'FAIL (could not reach the terminal instance)'
    return
  }

  // The shell echoes the line it is given, so the marker is assembled by printf
  // itself — searching for a marker that also sits in the echo finds the echo.
  const marker = 'SHELLHOOKOK'
  const payload = btoa('qatn')
  // Earlier checks can leave text sitting on the prompt; clear the line first.
  api.write(paneId, '\u0015')
  await sleep(200)
  // Both sequences, wrapped in ordinary text that must still be drawn.
  api.write(
    paneId,
    `printf 'A\\033]1173;A\\007B\\033]1173;C;${payload}\\007C SHELLHOOK%s\\n' OK\n`,
  )

  let text = ''
  for (let attempt = 0; attempt < 30 && !text.includes(`ABC ${marker}`); attempt++) {
    await sleep(200)
    term.selectAll()
    text = term.getSelection()
  }
  report['shellHookKeptOutput'] = text.includes(`ABC ${marker}`)
    ? 'ok'
    : text.includes(marker)
      ? `FAIL (text around the sequence was eaten: ${JSON.stringify(text.slice(text.indexOf(marker) - 12, text.indexOf(marker) + 12))})`
      : 'skipped (the marker never printed; the shell did not start)'

  let active = false
  for (let attempt = 0; attempt < 20 && !active; attempt++) {
    await sleep(200)
    active = (await api.shellIntegrationStatus()).active
  }
  report['shellHookReceived'] = active ? 'ok' : 'FAIL (the sourced marker never reached main)'
}

export async function checkImeInput(report: Report): Promise<void> {
  const paneId = focusedId()
  const hostEl = document.querySelector<HTMLElement>('.pane--focused .terminal-host')
  const textarea = hostEl?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
  const term = (hostEl as unknown as
    | { __term?: { selectAll(): void; getSelection(): string; clear(): void } }
    | null)?.__term
  if (paneId === undefined || textarea === undefined || textarea === null || term === undefined) {
    report['imeSingleInsert'] = 'FAIL (could not reach the terminal input element)'
    return
  }

  // cat echoes plainly; a shell line editor would obscure who drew what.
  api.write(paneId, 'cat\n')
  await sleep(900)
  term.clear()
  await sleep(200)

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
        await sleep(60)
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
  const seen = (): number => {
    term.selectAll()
    return term.getSelection().split(HAN).length - 1
  }

  const wrong: string[] = []
  for (const scenario of scenarios) {
    textarea.value = ''
    await sleep(150)
    const before = seen()
    await scenario.run()
    await sleep(600)
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
  document
    .querySelector<HTMLElement>('.session-host:not([hidden])')
    ?.dispatchEvent(new WheelEvent('wheel', { deltaY: -100_000, bubbles: true, cancelable: true }))
  await sleep(1200)

  // Push the cursor off the first row; an off-by-one row is invisible at row 0.
  api.write(paneId, 'x\nx\nx\n')
  await sleep(400)
  textarea.value = ''
  await sleep(150)
  key({ keyCode: 229 })
  comp('compositionstart', '')
  textarea.value = AN
  comp('compositionupdate', AN)
  input(AN, true)
  await sleep(250)

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
  await sleep(300)

  api.write(paneId, '\u0003') // end cat
  await sleep(300)
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
  if (capturePane !== undefined) {
    api.write(capturePane, 'sleep 300\n')
    await sleep(800)
  }

  const menu = document.querySelector<HTMLElement>('.app-bar__btn')
  menu?.click()
  await sleep(300)

  const item = [...document.querySelectorAll<HTMLButtonElement>('.command-menu__item')].find((b) =>
    b.textContent?.includes(t.firstRun.saveLayoutAs),
  )
  if (item === undefined) {
    report['saveSessionMenu'] = 'FAIL (the menu has no such item)'
    return
  }
  report['saveSessionMenu'] = 'ok'
  item.click()
  await sleep(400)

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

  await sleep(500)
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
  await sleep(1200)

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
  // Undo: the sleeping pane must not outlive this check.
  if (capturePane !== undefined) {
    api.write(capturePane, '\x03')
    await sleep(300)
  }

  // Reopening with an existing name must not silently overwrite.
  menu?.click()
  await sleep(250)
  ;[...document.querySelectorAll<HTMLButtonElement>('.command-menu__item')]
    .find((b) => b.textContent?.includes(t.firstRun.saveLayoutAs))
    ?.click()
  await sleep(400)
  const field2 = document.querySelector<HTMLInputElement>('.save-session__input')
  if (field2 !== null) {
    field2.value = name
    field2.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(600)
    const button2 = document.querySelector<HTMLButtonElement>('.save-session .button--accent')
    report['overwriteNeedsConsent'] =
      button2?.textContent === t.saveSession.overwrite ? 'ok' : `FAIL (${String(button2?.textContent)})`
  }
  press('Escape')
  await sleep(300)
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

  const refresh = [...document.querySelectorAll<HTMLButtonElement>('.sidebar__action')].find(
    (b) => b.title === t.sidebar.refreshList,
  )
  refresh?.click()
  await sleep(600)
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
  press('ArrowDown', { altKey: true, shiftKey: true })
  await sleep(2600)

  saveButton.click()
  await sleep(1200)

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
  await sleep(600)
  // Re-query: ending a session re-renders the list, detaching the row above.
  const stillRunning = [...document.querySelectorAll<HTMLElement>('.sidebar__row')].some(
    (row) =>
      row.querySelector('.sidebar__name')?.textContent === displayName &&
      row.querySelector('.sidebar__close') !== null,
  )
  report['saveCurrentEnded'] = stillRunning ? 'FAIL (still running)' : 'ok'
  await openSession('verify')
}

/**
 * Creating a blank session, and the sidebar context menu.
 */
export async function checkNewSession(report: Report): Promise<void> {
  // The menu differs over a row versus empty space.
  const row = document.querySelector<HTMLElement>('.sidebar__row')
  row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 140 }))
  await sleep(300)
  const rowItems = [...document.querySelectorAll<HTMLElement>('.command-menu:not([hidden]) .command-menu__item')]
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
  await sleep(250)

  const list = document.querySelector<HTMLElement>('.sidebar__list')
  list?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 520 }))
  await sleep(300)
  const emptyItems = [...document.querySelectorAll<HTMLElement>('.command-menu:not([hidden]) .command-menu__item')]
  report['sidebarEmptyMenu'] = emptyItems.map((b) => b.textContent).join(' / ') || 'none'
  report['sidebarEmptyMenuHasNew'] =
    emptyItems.some((b) => b.textContent === t.firstRun.newSession) ? 'ok' : 'FAIL'
  press('Escape')
  await sleep(250)

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
  await sleep(400)
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
  await sleep(600)
  report['blankRefusesExistingName'] = button.disabled ? 'ok' : 'FAIL (overwrite was allowed)'

  const name = 'selfcheck-blank'
  field.value = name
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(500)
  report['blankButtonSaysCreate'] =
    button.textContent === t.saveSession.create ? 'ok' : `FAIL (${String(button.textContent)})`

  button.click()
  await sleep(2600)

  const created = (await api.listSessions()).find((session) => session.id === name)
  report['blankSessionCreated'] =
    created === undefined ? 'FAIL (not in the list)' : `ok (${String(created.paneCount)} panes)`
  report['blankSessionReadable'] =
    created !== undefined && created.error === null ? 'ok' : `FAIL (${created?.error ?? 'none'})`
  // Opens immediately — picking it again would be a second step.
  report['blankSessionOpened'] = document.title.includes(name) ? 'ok' : `FAIL (${document.title})`

  /*
   * Delete it again. Must ask first, and must disappear from the list —
   * checking only the file would miss a stale listing.
   */
  const madeRow = [...document.querySelectorAll<HTMLElement>('.sidebar__row')].find(
    (r) => r.dataset['sessionId'] === name,
  )
  madeRow?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 160 }))
  await sleep(300)
  const deleteItem = [
    ...document.querySelectorAll<HTMLButtonElement>('.command-menu:not([hidden]) .command-menu__item'),
  ].find((b) => b.textContent === t.firstRun.deleteSession)
  deleteItem?.click()
  await sleep(400)

  const confirmLayer = document.querySelector<HTMLElement>('.confirm-close')
  report['deleteAsksFirst'] =
    confirmLayer !== null && !confirmLayer.hidden ? 'ok' : 'FAIL (deleted without asking)'

  const confirmButton = document.querySelector<HTMLButtonElement>('.confirm-close .button--danger')
  report['deleteGoesToTrash'] =
    confirmButton?.textContent === t.firstRun.deleteConfirm
      ? 'ok'
      : `FAIL (${String(confirmButton?.textContent)} — an irreversible delete)`
  confirmButton?.click()
  await sleep(1400)

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
    await sleep(400)
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
  const made = await api.createBlankSession(name, name, '~')
  if (!made.ok) {
    report['wheelSwitchSetup'] = `FAIL (${made.error ?? 'create failed'})`
    return
  }
  ;[...document.querySelectorAll<HTMLButtonElement>('.sidebar__action')]
    .find((b) => b.title === t.sidebar.refreshList)
    ?.click()
  const rowOf = (id: string): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>('.sidebar__row')].find(
      (r) => r.dataset['sessionId'] === id,
    )
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
  const notch = (): void => {
    // One mouse notch in line mode; sign follows where the target sits.
    list?.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: to > from ? 3 : -3,
        deltaMode: 1,
        bubbles: true,
        cancelable: true,
      }),
    )
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
  ;[...document.querySelectorAll<HTMLButtonElement>('.sidebar__action')]
    .find((b) => b.title === t.sidebar.refreshList)
    ?.click()
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
  const rowOf = (id: string): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>('.sidebar__row')].find(
      (r) => r.dataset['sessionId'] === id,
    )
  const refresh = (): void => {
    ;[...document.querySelectorAll<HTMLButtonElement>('.sidebar__action')]
      .find((b) => b.title === t.sidebar.refreshList)
      ?.click()
  }
  const wants = (id: string): boolean =>
    rowOf(id)?.querySelector('.sidebar__dot--wants') != null

  // The pane to ring: focused here, and still focused when this comes back.
  const rang = focusedId()
  if (rang === undefined) {
    report['returnClearsSetup'] = 'FAIL (no focused pane to ring)'
    return
  }

  const made = await api.createBlankSession(name, name, '~')
  if (!made.ok) {
    report['returnClearsSetup'] = `FAIL (${made.error ?? 'create failed'})`
    return
  }
  refresh()
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
  refresh()
  await waitFor(() => rowOf(name) === undefined)
}

/**
 * Alt+Shift+< / > steps between the sessions that are running.
 *
 * The ring is built from live runtimes, which no unit test can see: a check
 * against the sidebar alone would pass while the key opened a cold session.
 */
export async function checkSessionStepShortcut(report: Report): Promise<void> {
  const name = 'selfcheck-step'
  const made = await api.createBlankSession(name, name, '~')
  if (!made.ok) {
    report['stepSetup'] = `FAIL (${made.error ?? 'create failed'})`
    return
  }
  const refresh = (): void => {
    ;[...document.querySelectorAll<HTMLButtonElement>('.sidebar__action')]
      .find((b) => b.title === t.sidebar.refreshList)
      ?.click()
  }
  const rowOf = (id: string): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>('.sidebar__row')].find(
      (r) => r.dataset['sessionId'] === id,
    )
  const running = (): string[] =>
    [...document.querySelectorAll<HTMLElement>('.sidebar__row')]
      .filter((r) => r.querySelector('.sidebar__dot--on') !== null)
      .map((r) => r.dataset['sessionId'] ?? '?')

  refresh()
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
  refresh()
  await waitFor(() => rowOf(name) === undefined)
}

/** Copy-on-select needs feedback — the clipboard is invisible until pasted. */
export async function checkCopyToast(report: Report): Promise<void> {
  const hostEl = document.querySelector<HTMLElement>('.pane--focused .terminal-host')
  const term = (hostEl as unknown as { __term?: { selectAll(): void } } | null)?.__term
  if (term === undefined || hostEl === null) {
    report['copyToast'] = 'FAIL (could not reach the terminal)'
    return
  }
  term.selectAll()
  hostEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  await sleep(200)
  const toast = document.querySelector<HTMLElement>('.toast')
  // The toast copy up to the character count, which cannot be predicted here.
  const copiedPrefix = t.firstRun.copied('\u0000').split('\u0000')[0] ?? ''
  report['copyToast'] =
    toast !== null && !toast.hidden && (toast.textContent ?? '').includes(copiedPrefix)
      ? 'ok'
      : `FAIL (${String(toast?.hidden)} ${String(toast?.textContent)})`

  // Must fade; a permanent toast is scenery, not a notice.
  await sleep(1600)
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
  const hostEl = document.querySelector<HTMLElement>('.pane--focused .terminal-host')
  const term = (hostEl as unknown as
    | { __term?: { cols: number; rows: number; selectAll(): void; getSelection(): string; clear(): void } }
    | null)?.__term
  if (paneId === undefined || term === undefined) {
    report['resizeSync'] = 'FAIL (missing prerequisites for this check)'
    return
  }

  /** Ask stty directly. Comes back as one "rows cols" line. */
  const askPty = async (): Promise<string> => {
    term.clear()
    await sleep(200)
    api.write(paneId, 'stty size\n')
    await sleep(900)
    term.selectAll()
    const match = /(\d+)\s+(\d+)/.exec(term.getSelection().replace('stty size', ''))
    return match === null ? '?' : `${match[1]}x${match[2]}`
  }

  /*
   * xterm 6 draws its own scrollbar, so ::-webkit-scrollbar rules do nothing.
   * Measure the rendered width rather than trusting the stylesheet.
   */
  const slider = document.querySelector<HTMLElement>(
    '.pane--focused .xterm-scrollable-element > .scrollbar.vertical',
  )
  const sliderWidth = slider === null ? -1 : Math.round(slider.getBoundingClientRect().width)
  report['terminalScrollbarWidth'] = slider === null ? 'none' : `${String(sliderWidth)}px`
  report['terminalScrollbarIsThin'] =
    slider === null
      ? 'FAIL (no scrollbar)'
      : sliderWidth <= 8
        ? 'ok'
        : `FAIL (${String(sliderWidth)}px — thicker than the sheet's)`

  const before = await askPty()
  report['ptySizeBeforeResize'] = before

  /*
   * Resize by key, not by drag: the first handle isn't necessarily the focused
   * pane's column. Repeated presses also exercise the intermediate values.
   */
  for (let i = 0; i < 6; i++) {
    press('ArrowLeft', { ctrlKey: true, altKey: true })
    await sleep(30)
  }

  // Comfortably past the 100ms debounce.
  await sleep(900)

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
  await sleep(600)

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
  await sleep(500)
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
      (host) => host.querySelector('canvas') !== null,
    ).length

  // Faster than any autorepeat, so the check does not depend on the setting.
  for (let i = 0; i < 61; i++) {
    press('Digit2', { altKey: true })
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

  // Leave one session running: the checks after this one count what is open.
  const spare = [...document.querySelectorAll<HTMLButtonElement>('.sidebar__close')].find(
    (button) => button.closest('.sidebar__row')?.textContent?.includes('spare') === true,
  )
  spare?.click()
  await waitFor(() => document.querySelectorAll('.session-host').length === 1)
  report['heldJumpSpareEnded'] =
    document.querySelectorAll('.session-host').length === 1 ? 'ok' : 'FAIL (spare still running)'
}
