import { ACTION_IDS, defaultBindingsFor, formatChord } from '../../shared/keybindings'
import { t } from '../i18n'
import { IS_MAC } from '../platform'
import {
  capture,
  focusedHost,
  focusedId,
  overlay,
  panes,
  press,
  type Report,
  SKIPPED,
  sleep,
  termOf,
  trackOffset,
  trackSettles,
  visiblePanes,
  waitFor,
  wheel,
} from './harness'

/** Whichever dropdown is open, if any. */
const openMenu = (): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('.command-menu')].find((m) => !m.hidden) ?? null

/** The settings sheet, as the backdrop reports it — the sheet's own hidden is always false. */
const settingsOpen = (): boolean =>
  document.querySelector<HTMLElement>('.settings')?.closest<HTMLElement>('.sheet-layer')?.hidden ===
  false

const menuItems = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>('.command-menu:not([hidden]) .command-menu__item'),
]

export async function checkAppBarMenu(report: Report): Promise<void> {
  const bar = document.querySelector<HTMLElement>('.app-bar')
  if (bar === null) {
    report['appBar'] = 'FAIL (no app bar)'
    return
  }
  report['appBar'] = 'ok'
  report['appBarTitle'] = bar.querySelector('.app-bar__title')?.textContent ?? 'NONE'
  // mac has the native traffic lights instead of a drawn set of its own.
  const wins = bar.querySelectorAll('.app-bar__win').length
  const expectedWins = IS_MAC ? 0 : 3
  report['windowButtons'] =
    wins === expectedWins ? String(wins) : `FAIL (${String(wins)}, expected ${String(expectedWins)})`

  /*
   * The traffic lights float over the left of this row, so the first control
   * has to start clear of them. Measured in pixels: the inset is a padding on
   * the bar, and a class alone would not prove the room is actually there.
   */
  const firstControl = bar.querySelector<HTMLElement>('.app-bar__btn')
  if (!IS_MAC) {
    report['macTrafficLightInset'] = 'skipped: not mac, no traffic lights'
  } else if (firstControl === null) {
    report['macTrafficLightInset'] = 'FAIL (no control on the bar)'
  } else {
    const left = firstControl.getBoundingClientRect().left
    report['macTrafficLightInset'] =
      left >= 78 ? `ok (${left.toFixed(1)}px)` : `FAIL (first control at ${left.toFixed(1)}px)`
  }

  bar.querySelector<HTMLButtonElement>('.app-bar__btn')?.click()
  await waitFor(() => openMenu() !== null)
  const menu = document.querySelector<HTMLElement>('.command-menu')
  report['menuOpens'] = menu !== null && !menu.hidden ? 'ok' : 'FAIL'

  const entries = [...(menu?.querySelectorAll<HTMLButtonElement>('.command-menu__item') ?? [])]
  report['menuItems'] = entries.map((b) => b.firstChild?.textContent).join(' / ') || 'NONE'

  // Splitting lives in its own control, not the menu.
  const splitLabels = [t.appBar.splitUpItem, t.appBar.splitDownItem]
  report['menuHasNoSplit'] = entries.every(
    (b) => !splitLabels.some((label) => (b.textContent ?? '').includes(label)),
  )
    ? 'ok'
    : 'FAIL (splitting is still in the menu)'
  ;(entries.find((b) => b.firstChild?.textContent === t.firstRun.closePane) ?? entries[0])?.blur()
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
  )
  await waitFor(() => openMenu() === null)
}

/** Split control: one button opening a dropdown of all four directions. */
export async function checkSplitControl(report: Report): Promise<void> {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.app-bar__btn')]
  // menu, sidebar, split, save
  report['splitControlPresent'] = buttons.length >= 4 ? 'ok' : `FAIL (${buttons.length} buttons)`

  const chevron = buttons.find((b) => b.dataset['action'] === 'split-menu')
  if (chevron === undefined) {
    report['splitControl'] = 'FAIL (button not found)'
    return
  }
  // The default-action button beside it was dropped; it must not creep back.
  report['splitHasNoDefaultButton'] = buttons.some((b) => b.dataset['action'] === 'split-down')
    ? 'FAIL (a default split button is on the bar again)'
    : 'ok'

  /*
   * Start from a column nobody has touched.
   *
   * Splitting is refused once a pane would fall below the minimum height, so
   * inheriting panes from an earlier check turns this into a test of the window
   * size. Each direction below is tried from one pane and undone afterwards.
   */
  const beforeMove = focusedId()
  press('ArrowRight', { altKey: true })
  await waitFor(() => focusedId() !== beforeMove)
  const canvasEl = document.querySelector<HTMLElement>('.session-host:not([hidden])')
  report['splitCanvasHeight'] = String(canvasEl?.clientHeight ?? 0)

  const undoSplit = async (): Promise<void> => {
    const n = panes().length
    press('KeyW', { altKey: true, shiftKey: true })
    await waitFor(() => panes().length === n - 1)
  }

  // All four directions must be listed.
  chevron.click()
  await waitFor(() => menuItems().length > 0)
  const labels = menuItems().map((b) => b.firstChild?.textContent)
  report['splitMenuDirections'] = labels.join(' / ') || 'NONE'
  report['splitMenuHasFour'] =
    labels.length === 4 ? 'ok' : `FAIL (${String(labels.length)})`

  // Split down must insert below.
  const before = panes().length
  const down = menuItems().find((b) => b.firstChild?.textContent === t.appBar.splitDownItem)
  report['splitDownEnabled'] =
    down?.disabled === false ? 'ok' : `FAIL (disabled=${String(down?.disabled)})`
  down?.click()
  await waitFor(() => panes().length === before + 1)
  report['splitMenuSplitsDown'] =
    panes().length === before + 1 ? 'ok' : `FAIL ${before}→${panes().length}`
  await undoSplit()

  // Split up must insert above.
  chevron.click()
  await waitFor(() => menuItems().length > 0)
  const upBefore = panes().length
  const up = menuItems().find((b) => b.firstChild?.textContent === t.appBar.splitUpItem)
  report['splitUpEnabled'] = up?.disabled === false ? 'ok' : `FAIL (disabled=${String(up?.disabled)})`
  up?.click()
  await waitFor(() => panes().length === upBefore + 1)
  report['splitUpWorks'] =
    panes().length === upBefore + 1 ? 'ok' : `FAIL ${upBefore}→${panes().length}`
  await undoSplit()

  /*
   * And a column on the left. Counted in panes rather than drag handles: those
   * are drawn only for what is near the viewport, so a narrow window has fewer.
   */
  chevron.click()
  await waitFor(() => menuItems().length > 0)
  const columnsBefore = panes().length
  const left = menuItems().find((b) => b.firstChild?.textContent === t.appBar.addColumnLeft)
  const columns = (): number => panes().length
  left?.click()
  await waitFor(() => columns() === columnsBefore + 1)
  report['addColumnLeftWorks'] =
    columns() === columnsBefore + 1 ? 'ok' : `FAIL ${columnsBefore}→${columns()}`

  // Capture the open dropdown — spacing and tone need eyes.
  chevron.click()
  await waitFor(() => menuItems().length > 0)
}

/**
 * The count beside the current session must be the live one.
 *
 * It used to come from the YAML, which a split never touches, so the number
 * stayed put however many panes were on screen.
 */
async function checkSidebarCountFollowsSplits(report: Report): Promise<void> {
  const meta = (): string =>
    document.querySelector('.sidebar__row--current .sidebar__meta')?.textContent ?? ''
  const shown = meta()
  const before = panes().length
  if (shown !== String(before)) {
    report['sidebarCountMatchesPanes'] = `FAIL (list ${shown || 'none'} vs ${String(before)} panes)`
    return
  }
  report['sidebarCountMatchesPanes'] = `ok (${shown})`

  press('ArrowDown', { altKey: true, shiftKey: true })
  if (!(await waitFor(() => panes().length === before + 1))) {
    // A short window refuses the split; that says nothing about the count.
    report['sidebarCountFollowsSplit'] = 'skipped (split refused, window too short)'
    return
  }
  report['sidebarCountFollowsSplit'] = (await waitFor(() => meta() === String(before + 1)))
    ? `ok (${shown}→${meta()})`
    : `FAIL (still ${meta()} with ${String(panes().length)} panes)`

  press('KeyW', { altKey: true, shiftKey: true })
  await waitFor(() => panes().length === before)
}

export async function checkSidebar(report: Report): Promise<void> {
  const workspace = document.querySelector<HTMLElement>('.workspace')!
  const sidebar = document.querySelector<HTMLElement>('.sidebar')
  report['sidebarPresent'] = sidebar === null ? 'FAIL' : 'ok'

  // The list must mark which session is current and which are running.
  report['sidebarRows'] = String(document.querySelectorAll('.sidebar__row').length)
  report['sidebarMarksCurrent'] =
    document.querySelectorAll('.sidebar__row--current').length === 1 ? 'ok' : 'FAIL'
  report['sidebarMarksRunning'] =
    document.querySelectorAll('.sidebar__dot--on').length >= 1 ? 'ok' : 'FAIL'

  await checkSidebarCountFollowsSplits(report)

  // The sidebar gap must match the gap between panes. Measured from real
  // positions, not recomputed — a wrong formula would otherwise pass itself.
  // Requires scroll at 0, or the first pane is pushed off to the left.
  const canvasHost = document.querySelector<HTMLElement>('.session-host:not([hidden])')
  wheel(canvasHost, -100_000, 0)
  // Wait for 0; leftover inertia would still have the pane displaced.
  await waitFor(() => trackOffset() === 0, 5000)

  const sidebarBox = sidebar?.getBoundingClientRect()
  const paneBoxes = [
    ...document.querySelectorAll<HTMLElement>('.session-host:not([hidden]) .pane'),
  ].map((p) => p.getBoundingClientRect())
  const firstPane = paneBoxes.reduce<DOMRect | null>(
    (best, box) => (best === null || box.left < best.left ? box : best),
    null,
  )

  if (trackOffset() !== 0) {
    // Never reached the left edge, so the gap can't be measured here.
    report['gapsMatch'] = SKIPPED
  } else if (sidebarBox !== undefined && firstPane !== null) {
    const sidebarGap = Math.round(firstPane.left - sidebarBox.right)
    // The pane-to-pane gap this must match.
    const columnLefts = [...new Set(paneBoxes.map((b) => Math.round(b.left)))].sort((a, b) => a - b)
    const firstRight = Math.round(firstPane.right)
    const nextLeft = columnLefts.find((x) => x > firstRight)
    const paneGap = nextLeft === undefined ? null : nextLeft - firstRight

    report['gapSidebarToPane'] = `${sidebarGap}px`
    report['gapPaneToPane'] = paneGap === null ? 'unmeasurable' : `${paneGap}px`
    report['gapsMatch'] =
      paneGap === null || sidebarGap === paneGap
        ? `ok (${sidebarGap}px)`
        : `MISMATCH (sidebar ${sidebarGap}px vs pane ${paneGap}px)`
  }

  /*
   * Collapsing the sidebar changes the canvas width, not where you are
   * looking, so the scroll position must survive it.
   */
  // Park away from 0, where a jump would be invisible.
  const canvasEl = document.querySelector<HTMLElement>('.session-host:not([hidden])')
  wheel(canvasEl, 0, 600)
  const parkedAt = await trackSettles()
  const collapsed = (): boolean => workspace.classList.contains('canvas--sidebar-hidden')
  const wasCollapsed = collapsed()
  press('KeyS', { altKey: true })
  await waitFor(() => collapsed() !== wasCollapsed)
  press('KeyS', { altKey: true })
  await waitFor(() => collapsed() === wasCollapsed)
  // The scroll is restored on the layout pass behind the sidebar's own.
  await trackSettles()
  report['sidebarToggleKeepsScroll'] =
    parkedAt === 0
      ? 'unmeasurable (scroll is 0, so a jump would be invisible)'
      : trackOffset() === parkedAt
        ? `ok (held at ${String(parkedAt)}px)`
        : `FAIL (dragged from ${String(parkedAt)} to ${String(trackOffset())}px)`

  // Alt+S collapses, it does not open a modal.
  const hiddenBefore = collapsed()
  press('KeyS', { altKey: true })
  await waitFor(() => collapsed() !== hiddenBefore)
  const hiddenAfter = collapsed()
  report['altSTogglesSidebar'] = hiddenAfter !== hiddenBefore ? 'ok' : 'FAIL'

  // The list is a view; collapsing it must not touch the session.
  report['sessionSurvivesCollapse'] = visiblePanes().length > 0 ? 'ok' : 'FAIL'

  press('KeyS', { altKey: true })
  await waitFor(() => collapsed() === hiddenBefore)
  report['altSRestoresSidebar'] =
    workspace.classList.contains('canvas--sidebar-hidden') === hiddenBefore ? 'ok' : 'FAIL'
}

export async function checkSettings(report: Report): Promise<void> {
  press('Comma', { ctrlKey: true })
  await waitFor(settingsOpen)

  const sheet = document.querySelector<HTMLElement>('.settings')
  // The backdrop is what toggles; the inner sheet's hidden is always false.
  if (sheet === null || sheet.closest<HTMLElement>('.sheet-layer')?.hidden !== false) {
    report['settingsOpens'] = 'FAIL (Ctrl+, did not open it)'
    return
  }
  report['settingsOpens'] = 'ok'

  // No dropdown from an earlier step may sit above the settings.
  const openMenus = [...document.querySelectorAll<HTMLElement>('.command-menu')].filter(
    (m) => !m.hidden,
  )
  report['settingsClosesMenus'] =
    openMenus.length === 0 ? 'ok' : `FAIL (${String(openMenus.length)} dropdowns still open)`

  // By name, not position: a row added above used to point this at another control.
  // The row is redrawn when fc-list answers, so ask the document each time.
  const fontSelect = (): HTMLSelectElement | null =>
    sheet.querySelector<HTMLSelectElement>('[data-setting="fontFamily"]')
  // fc-list is spawned as the screen opens and given three seconds of its own.
  await waitFor(() => (fontSelect()?.options.length ?? 0) > 1, 6000)
  const fontOptions = [...(fontSelect()?.options ?? [])]
  report['fontChoices'] = String(fontOptions.length)
  report['fontListLoaded'] =
    fontOptions.length > 1 ? 'ok' : 'FAIL (nothing to choose but the default; fc-list returned nothing)'
  // Icon and emoji fonts report as monospace but render nothing readable.
  const junk = fontOptions.filter((option) =>
    /emoji|icons|signwriting/i.test(option.value),
  )
  report['fontListHasNoIconFonts'] =
    junk.length === 0 ? 'ok' : `FAIL (${junk.map((o) => o.value).join(', ')})`

  // Palette list.
  const themeSelect = sheet.querySelector<HTMLSelectElement>('[data-setting="theme"]')
  const themeIds = [...(themeSelect?.options ?? [])].map((o) => o.value)
  report['themeChoices'] = String(themeIds.length)
  report['themeListHasKanagawaWave'] =
    themeIds.includes('kanagawa-wave') ? 'ok' : `FAIL (${themeIds.join(',')})`
  report['themeSwatches'] = String(sheet.querySelectorAll('.settings__swatch').length)

  // Picking one must actually change the terminal colours.
  const paneBg = (): string => termOf(focusedHost())?.options.theme?.background ?? '?'
  const bgBefore = paneBg()
  if (themeSelect !== null) {
    themeSelect.value = 'kanagawa-wave'
    themeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => paneBg() === '#1f1f28')
  }
  report['themeAppliesToTerminal'] =
    paneBg() === '#1f1f28'
      ? `ok (${bgBefore} → ${paneBg()})`
      : `FAIL (${bgBefore} → ${paneBg()})`

  /*
   * The pane background must follow too, or the body's inset padding shows as
   * a mismatched band inside the rounded corners.
   */
  const paneEl = document.querySelector<HTMLElement>('.session-host:not([hidden]) .pane')
  const paneStyle = paneEl === null ? null : getComputedStyle(paneEl).backgroundColor
  report['paneBgFollowsTheme'] =
    paneStyle === 'rgb(31, 31, 40)'
      ? 'ok'
      : `FAIL (${String(paneStyle)} — terminal is #1f1f28, pane is not)`

  // Restore — the check must not alter the user's settings.
  if (themeSelect !== null) {
    themeSelect.value = 'termspace'
    themeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => paneBg() === bgBefore)
  }

  /*
   * The focused pane's border colour.
   *
   * Read as a computed colour off the pane itself: the setting writes a custom
   * property on the root, and only the resolved border proves it reached the
   * pane rather than the token still winning.
   */
  const focusRow = (): { select: HTMLSelectElement; hex: HTMLInputElement } | null => {
    const select = sheet.querySelector<HTMLSelectElement>('select[data-setting="focusBorder"]')
    const hex = sheet.querySelector<HTMLInputElement>('input[data-setting="focusBorderColor"]')
    return select === null || hex === null ? null : { select, hex }
  }
  const focusedBorder = (): string | null => {
    const pane = document.querySelector<HTMLElement>('.session-host:not([hidden]) .pane--focused')
    return pane === null ? null : getComputedStyle(pane).borderTopColor
  }
  const whiteBorder = focusedBorder()

  if (focusRow() === null) {
    report['focusBorderControl'] = 'FAIL (no focused pane border row)'
  } else if (whiteBorder === null) {
    report['focusBorderControl'] = 'skipped: no focused pane on screen'
  } else {
    report['focusBorderControl'] = 'ok'

    // Each commit redraws the sheet, so the controls are found again every time.
    const picked = focusRow()
    if (picked !== null) {
      picked.select.value = 'custom'
      picked.select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await waitFor(() => focusRow()?.hex.disabled === false)
    report['focusBorderCustomEnablesField'] =
      focusRow()?.hex.disabled === false ? 'ok' : 'FAIL (the colour field stayed inert)'

    const typed = focusRow()?.hex
    if (typed !== undefined) {
      typed.value = '#ff0000'
      typed.dispatchEvent(new Event('input', { bubbles: true }))
      typed.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await waitFor(() => focusedBorder() === 'rgb(255, 0, 0)')
    report['focusBorderCustomPaintsThePane'] =
      focusedBorder() === 'rgb(255, 0, 0)'
        ? `ok (${whiteBorder} → ${String(focusedBorder())})`
        : `FAIL (${whiteBorder} → ${String(focusedBorder())})`

    // Restore — the check must not alter the user's settings.
    const back = focusRow()
    if (back !== null) {
      back.select.value = 'white'
      back.select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await waitFor(() => focusedBorder() === whiteBorder)
    report['focusBorderWhiteRestoresTheToken'] =
      focusedBorder() === whiteBorder ? 'ok' : `FAIL (${String(focusedBorder())})`
  }

  /*
   * Interface size. Measured in pixels rather than read back off the slider:
   * the setting is only worth anything if the chrome actually grows, and the
   * canvas beside it must not, since a column's width is an absolute count.
   */
  const scaleSlider = sheet.querySelector<HTMLInputElement>('input[data-setting="uiScale"]')
  const bar = document.querySelector<HTMLElement>('.app-bar')
  if (scaleSlider === null || bar === null) {
    report['uiScaleControl'] = 'FAIL (no interface size slider)'
  } else {
    report['uiScaleControl'] = 'ok'
    const barBefore = bar.getBoundingClientRect().height
    const trackBefore = document.querySelector<HTMLElement>('.canvas-track')?.getBoundingClientRect()

    scaleSlider.value = '150'
    scaleSlider.dispatchEvent(new Event('input', { bubbles: true }))
    scaleSlider.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => bar.getBoundingClientRect().height > barBefore + 4)

    const barAfter = bar.getBoundingClientRect().height
    report['uiScaleGrowsTheBar'] =
      barAfter > barBefore + 4
        ? `ok (${barBefore.toFixed(1)} → ${barAfter.toFixed(1)})`
        : `FAIL (${barBefore.toFixed(1)} → ${barAfter.toFixed(1)})`

    const trackAfter = document.querySelector<HTMLElement>('.canvas-track')?.getBoundingClientRect()
    report['uiScaleLeavesColumnsAlone'] =
      trackBefore === undefined || trackAfter === undefined
        ? 'skipped: no canvas on screen'
        : Math.abs(trackAfter.width - trackBefore.width) < 1
          ? 'ok'
          : `FAIL (${trackBefore.width.toFixed(1)} → ${trackAfter.width.toFixed(1)})`

    // Restore — the check must not alter the user's settings.
    scaleSlider.value = '100'
    scaleSlider.dispatchEvent(new Event('input', { bubbles: true }))
    scaleSlider.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => Math.abs(bar.getBoundingClientRect().height - barBefore) < 1)
  }

  // Binary settings get a two-segment control, not a slider.
  const segments = [...sheet.querySelectorAll<HTMLElement>('.settings__segment')]
  report['settingsToggles'] =
    segments.length >= 2 ? `ok (${String(segments.length / 2)})` : 'FAIL (no on/off control)'

  // Read the lit segment by label — clicking re-renders, so references go stale.
  const litLabel = (): string | null =>
    document.querySelector<HTMLElement>('.settings__segment--on')?.textContent ?? null
  const before = litLabel()
  segments.find((s) => !s.classList.contains('settings__segment--on'))?.click()
  await waitFor(() => litLabel() !== before)
  const after = litLabel()
  report['settingsToggleFlips'] =
    before !== null && after !== null && before !== after ? 'ok' : `FAIL (${String(before)} → ${String(after)})`

  /*
   * The settings sheet covers the canvas but not the sidebar, so a session can
   * be picked while it is open — it must dismiss rather than open behind.
   */
  /*
   * Force the hover-only parts visible for the screenshot. Synthetic mouse
   * events do not set :hover, and these are exactly the bits that have to be
   * looked at rather than queried.
   */
  const hoverOnly = [
    ...document.querySelectorAll<HTMLElement>('.sidebar__hint, .sidebar__close'),
  ]
  for (const el of hoverOnly) el.style.opacity = '1'
  report['sidebarHintShown'] = hoverOnly.some((e) => e.classList.contains('sidebar__hint'))
    ? 'ok'
    : 'FAIL (no Alt+N hint)'
  await capture(report, 'sidebar-row')
  for (const el of hoverOnly) el.style.removeProperty('opacity')

  const sessionButton = document.querySelector<HTMLButtonElement>('.sidebar__open')
  sessionButton?.click()
  await waitFor(() => !settingsOpen() && visiblePanes().length > 0, 10_000)
  report['sidebarClosesSettings'] =
    document.querySelector<HTMLElement>('.settings')?.closest<HTMLElement>('.sheet-layer')
      ?.hidden === true
      ? 'ok'
      : 'FAIL (settings stayed open after picking a session)'
  report['sidebarShowsSession'] =
    visiblePanes().length > 0 ? 'ok' : 'FAIL (settings closed but the canvas is empty)'

  // Reopen for the remaining checks.
  press('Comma', { ctrlKey: true })
  await waitFor(settingsOpen)

  // Restore — the check must not alter the user's settings.
  document
    .querySelectorAll<HTMLElement>('.settings__segment')
    .forEach((s) => {
      if (s.textContent === before && !s.classList.contains('settings__segment--on')) s.click()
    })
  await waitFor(() => litLabel() === before)
  report['settingsToggleRestored'] = litLabel() === before ? 'ok' : 'FAIL'
}

/**
 * The Shortcuts tab: rows drawn, a rebind taking effect on the live app, and
 * the whole lot restored. Nothing here is visible to a unit test — the panel
 * only receives keys through the settings screen's window listener.
 */
export async function checkKeybindings(report: Report): Promise<void> {
  const sheet = document.querySelector<HTMLElement>('.settings')
  const tab = sheet?.querySelector<HTMLButtonElement>('.settings__tab[data-tab="keys"]') ?? null
  if (tab === null) {
    report['keysTabPresent'] = 'FAIL (no Shortcuts tab)'
    return
  }
  report['keysTabPresent'] = 'ok'
  tab.click()
  await waitFor(() => document.querySelector('.keys__row') !== null)

  const rows = [...document.querySelectorAll<HTMLElement>('.keys__row')]
  report['keysRows'] =
    rows.length === ACTION_IDS.length ? `ok (${rows.length})` : `FAIL (${rows.length} rows)`
  // A row present but collapsed would pass every DOM query and show nothing.
  const rowBox = rows[0]?.getBoundingClientRect()
  report['keysRowsDrawn'] =
    rowBox !== undefined && rowBox.width > 100 && rowBox.height > 10
      ? 'ok'
      : `FAIL (${Math.round(rowBox?.width ?? 0)}x${Math.round(rowBox?.height ?? 0)})`
  await capture(report, 'shortcuts')

  /*
   * The settings screen stops keydown at window capture, which would eat every
   * character before the search field saw it. Nothing reads back from a keydown
   * alone, so listen at the field and see whether the event survives the trip.
   */
  const field = document.querySelector<HTMLInputElement>('.keys__search')
  let reachedField = false
  field?.addEventListener('keydown', () => {
    reachedField = true
  })
  field?.focus()
  field?.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true, cancelable: true }),
  )
  report['keysSearchTypable'] =
    reachedField ? 'ok' : 'FAIL (the settings screen swallowed the keystroke)'

  /*
   * Hangul takes several keystrokes per syllable, so the field must survive a
   * redraw. Rebuilding it on every input event killed the composition halfway.
   */
  if (field !== null) {
    field.focus()
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    for (const step of ['ㅍ', '포', '폭', '포커']) {
      field.value = step
      field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
      // The IME's own cadence between syllables; there is nothing to wait for.
      await sleep(30)
    }
    const sameField = document.querySelector<HTMLInputElement>('.keys__search') === field
    field.value = '포커스'
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    const typedField = (): HTMLInputElement | null =>
      document.querySelector<HTMLInputElement>('.keys__search')
    await waitFor(() => typedField()?.value === '포커스', 1000)
    report['keysSearchSurvivesComposition'] =
      sameField ? 'ok' : 'FAIL (the field was replaced mid-composition)'
    report['keysSearchKeepsTypedText'] =
      document.querySelector<HTMLInputElement>('.keys__search')?.value === '포커스'
        ? 'ok'
        : `FAIL (${document.querySelector<HTMLInputElement>('.keys__search')?.value ?? 'gone'})`
    field.value = ''
    field.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await waitFor(() => typedField()?.value === '', 1000)
  }

  const overviewRow = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('.keys__row[data-action="overview"]')
  const chip = (): string =>
    overviewRow()?.querySelector<HTMLElement>('.keys__chord')?.textContent ?? '?'

  overviewRow()?.querySelector<HTMLButtonElement>('.keys__chord')?.click()
  await waitFor(() => overviewRow()?.querySelector('.keys__chord--recording') !== null)
  report['keysRecording'] =
    overviewRow()?.querySelector('.keys__chord--recording') !== null
      ? 'ok'
      : 'FAIL (clicking a chord did not start recording)'

  // Not a default chord, so it is recorded as pressed on either platform —
  // only its spelling on the chip follows the platform.
  const recorded = formatChord('Alt+Space', IS_MAC)
  press('Space', { altKey: true })
  await waitFor(() => chip() === recorded)
  report['keysRecorded'] = chip() === recorded ? 'ok' : `FAIL (${chip()})`

  // The point of the whole tab: the app must obey the new chord straight away.
  press('Escape')
  await waitFor(() => !settingsOpen())
  press('Space', { altKey: true })
  await waitFor(() => overlay() !== null)
  report['keysRebindApplies'] = overlay() !== null ? 'ok' : 'FAIL (Alt+Space did not open the map)'
  press('Space', { altKey: true })
  await waitFor(() => overlay() === null)

  // The old chord must have gone back to the terminal. Nothing positive can be
  // waited for, so wait for the map that must not open.
  press('KeyM', { altKey: true })
  await waitFor(() => overlay() !== null, 400)
  report['keysOldChordReleased'] =
    overlay() === null ? 'ok' : 'FAIL (Alt+M still opens the map)'
  if (overlay() !== null) {
    press('Escape')
    await waitFor(() => overlay() === null)
  }

  press('Comma', { ctrlKey: true })
  await waitFor(settingsOpen)
  document.querySelector<HTMLButtonElement>('.settings__tab[data-tab="keys"]')?.click()
  await waitFor(() => document.querySelector('.keys__row') !== null)
  const stock = formatChord(defaultBindingsFor(IS_MAC)['overview'][0] as string, IS_MAC)
  document.querySelector<HTMLButtonElement>('.keys__reset-all')?.click()
  await waitFor(() => chip() === stock)
  report['keysResetAll'] = chip() === stock ? 'ok' : `FAIL (${chip()})`

  // Leave the screen as the next check expects to find it.
  document.querySelector<HTMLButtonElement>('.settings__tab[data-tab="general"]')?.click()
  await waitFor(() => document.querySelector('.keys__row') === null)
  press('Escape')
  await waitFor(() => !settingsOpen())
}

/** Scrollback search: count, highlight pixels, and the close rules. */
export async function checkScrollbackSearch(report: Report): Promise<void> {
  const host = focusedHost()
  const term = termOf(host)
  if (host === null || term === undefined) {
    report['searchSetup'] = 'FAIL (no focused terminal)'
    return
  }
  // Paint known text straight into the buffer; the pty stays out of it.
  await new Promise<void>((resolve) => term.write('needle one\r\nneedle two\r\n', resolve))

  const bar = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('.pane--focused .search-bar')
  press('KeyF', { ctrlKey: true, shiftKey: true })
  await waitFor(() => bar() !== null)
  report['searchBarOpens'] = bar() !== null ? 'ok' : 'FAIL'
  const input = bar()?.querySelector<HTMLInputElement>('.search-bar__input')
  if (input == null) {
    report['searchInput'] = 'FAIL (no input)'
    return
  }

  input.value = 'needle'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  const countText = (): string => bar()?.querySelector('.search-bar__count')?.textContent ?? ''
  await waitFor(() => countText().endsWith('/2'))
  report['searchCount'] = countText().endsWith('/2') ? `ok (${countText()})` : `FAIL (${countText()})`

  // Decorations are real elements; measure one rather than trusting state.
  const decorations = (): HTMLElement[] => [
    ...document.querySelectorAll<HTMLElement>('.pane--focused .xterm-decoration'),
  ]
  await waitFor(() => decorations().length >= 1)
  const rect = decorations()[0]?.getBoundingClientRect()
  report['searchHighlight'] =
    rect !== undefined && rect.width > 0 && rect.height > 0
      ? `ok (${decorations().length} decorations)`
      : 'FAIL (no visible decoration)'

  const before = countText()
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  )
  await waitFor(() => countText() !== before)
  report['searchEnterAdvances'] =
    countText() !== before ? `ok (${before}→${countText()})` : `FAIL (stuck at ${before})`

  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
  await waitFor(() => bar() === null)
  report['searchEscCloses'] = bar() === null ? 'ok' : 'FAIL'
  await waitFor(() => decorations().length === 0)
  report['searchHighlightCleared'] =
    decorations().length === 0 ? 'ok' : `LEAKED (${decorations().length} decorations)`

  // Moving pane focus must take the bar with it.
  const other = visiblePanes().find((p) => !p.classList.contains('pane--focused'))
  if (other === undefined) {
    report['searchClosesOnFocusMove'] = 'skipped: only one pane on screen'
    return
  }
  const startPane = focusedId()
  press('KeyF', { ctrlKey: true, shiftKey: true })
  await waitFor(() => bar() !== null)
  other.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await waitFor(() => bar() === null)
  report['searchClosesOnFocusMove'] = bar() === null ? 'ok' : 'FAIL (bar survived focus move)'
  // Put focus back where the check found it.
  const start = startPane === undefined ? null : document.querySelector(`[data-pane-id="${startPane}"]`)
  start?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await waitFor(() => focusedId() === startPane)
}
