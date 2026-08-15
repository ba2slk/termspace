import '@xterm/xterm/css/xterm.css'
import './styles/tokens.css'
import './styles/app.css'
import type { AppSettings, Bindings, SessionSummary } from '../shared/protocol'
import { DEFAULT_SETTINGS } from '../shared/settings-defaults'
import { defaultBindingsFor, formatChord, type ActionId } from '../shared/keybindings'
import { shorten } from '../shared/home-path'
import { api } from './api'
import { createAppBar } from './app-bar'
import { createEmptyCanvas } from './empty-canvas'
import { resolveFocusBorder } from './focus-border'
import { barTitle } from './pane-title'
import { nextPeek, type PeekEvent } from './peek-state'
import { createCommandMenu, type CommandItem } from './command-menu'
import { isAppAction, resolveAction } from './keymap'
import { createConfirmCloseView, type ConfirmRequest } from './confirm-close-view'
import { createSaveSessionView } from './save-session-view'
import { stepSession } from './session-ring'
import { createSessionSidebar } from './session-sidebar'
import { startSession, type SessionRuntime } from './session-runtime'
import { createSettingsView } from './settings-view'
import { createToast } from './toast'
import { t } from './i18n'
import { IS_MAC } from './platform'
import { asTextField, selectedText, withPasted } from './text-field-edit'
import { themeById, type TerminalTheme } from '../shared/terminal-themes'

// The title bar has to clear the native traffic lights on mac; the platform
// cannot change while the window is open, so this is set once.
document.body.classList.toggle('is-mac', IS_MAC)

const shell = document.getElementById('app')!
const workspace = document.getElementById('workspace')!
const canvasHost = document.getElementById('canvas')!

/**
 * Live runtimes per session. Switching keeps ptys, focus and scroll position,
 * so returning finds things as they were. The sidebar's dots mirror this map.
 */
const runtimes = new Map<string, SessionRuntime>()
const hosts = new Map<string, HTMLElement>()
let currentName: string | null = null
/** $HOME, only for showing paths in `~` form. Empty until boot fills it in. */
let home = ''

/** Until main answers with the file's values. */
let settings: AppSettings = DEFAULT_SETTINGS

/** Replaced whole, never mutated — keymap caches its lookup on identity. */
let bindings: Bindings = defaultBindingsFor(IS_MAC)

/**
 * Scrim strength for unfocused panes, passed as one CSS variable rather than
 * inline styles that every new pane would have to reapply.
 */
function applyIdleDim(percent: number): void {
  // The 10,10,10 base mirrors --scrim-idle in tokens.css; change both together.
  document.documentElement.style.setProperty('--scrim-idle', `rgba(10, 10, 10, ${percent / 100})`)
}

/** Every chrome size is a multiple of this; the canvas ignores it. */
function applyUiScale(percent: number): void {
  document.documentElement.style.setProperty('--ui-scale', String(percent / 100))
}

/**
 * User palettes, added to the bundled ones.
 *
 * One list, here: the settings screen shows it and the terminals resolve
 * against it, and a second copy would let the picker offer a palette that the
 * panes cannot find.
 */
let userThemes: readonly TerminalTheme[] = []

/** Re-read the themes folder. The user may have added a file since boot. */
async function refreshUserThemes(): Promise<readonly TerminalTheme[]> {
  userThemes = await api.listUserThemes()
  return userThemes
}

/** Resolve the configured name to colours, falling back to the default. */
const currentTheme = (): TerminalTheme => themeById(settings.theme, userThemes)

/**
 * Lift the terminal background onto the pane itself.
 *
 * The body's inset padding keeps text off the border, but painted in the panel
 * colour it shows as a mismatched band once the palette changes. Matching the
 * pane to the terminal makes the whole rounded rectangle read as terminal.
 */
function applyTerminalBackground(theme: TerminalTheme): void {
  document.documentElement.style.setProperty('--term-bg', theme.background)
  // The IME preedit overlay draws with these; see .composition-view.
  document.documentElement.style.setProperty('--term-fg', theme.foreground)
}

/**
 * Colour the focused pane's border, or hand it back to the tokens.
 *
 * Removing the properties rather than writing the token's own value keeps one
 * definition of white: `.pane--focused` falls back to --border-active by
 * itself.
 */
function applyFocusBorder(next: AppSettings, theme: TerminalTheme): void {
  const style = document.documentElement.style
  const resolved = resolveFocusBorder(next, theme)
  if (resolved === null) {
    style.removeProperty('--focus-border')
    style.removeProperty('--focus-ring')
    return
  }
  style.setProperty('--focus-border', resolved.border)
  style.setProperty('--focus-ring', resolved.ring)
}

/** Brief notices for things that happen out of sight, like the clipboard. */
const toast = createToast(workspace)

const current = (): SessionRuntime | undefined =>
  currentName === null ? undefined : runtimes.get(currentName)

// ── Empty canvas ────────────────────────────────────────

const placeholder = createEmptyCanvas()
canvasHost.append(placeholder.el)

function syncPlaceholder(): void {
  placeholder.setHidden(currentName !== null)
}

/**
 * With nothing on the canvas the list is the only thing to act on, so it opens
 * itself. Alt+S still works — this only keeps you from landing on a blank
 * screen with no way forward showing.
 */
function revealListWhenEmpty(): void {
  if (currentName !== null || sidebar.visible) return
  sidebar.setVisible(true)
  appBar.setSidebarVisible(true)
}

// ── Command menu ────────────────────────────────────────

/**
 * The ☰ menu. Splitting has its own control, leaving occasional app-level
 * commands here.
 */
/**
 * The chord to print beside a menu item. Empty when the action has been
 * unbound, which the menu reads as "no shortcut" and leaves the hint off.
 */
function hintFor(id: ActionId): string {
  const chord = bindings[id][0]
  return chord === undefined ? '' : formatChord(chord, IS_MAC)
}

function commandItems(): readonly CommandItem[] {
  const session = current()

  return [
    {
      label: t.firstRun.closePane,
      hint: hintFor('close-pane'),
      disabled: session === undefined,
      run: () => session?.closeFocusedPane(),
    },
    { label: t.firstRun.newSession, separatorBefore: true, run: openNewSession },
    {
      label: t.firstRun.saveLayout,
      hint: hintFor('save-layout'),
      disabled: session === undefined,
      run: () => void saveCurrentLayout(),
    },
    {
      label: t.firstRun.saveLayoutAs,
      disabled: session === undefined,
      run: () => void openSaveSession(),
    },
    {
      label: t.firstRun.editSessionFile,
      disabled: currentName === null,
      run: () => {
        if (currentName !== null) void editSessionFile(currentName)
      },
    },
    {
      label: sidebar.visible ? t.firstRun.hideSessionList : t.firstRun.showSessionList,
      hint: hintFor('toggle-sidebar'),
      separatorBefore: true,
      run: toggleSidebar,
    },
    { label: t.firstRun.settings, hint: hintFor('settings'), run: openSettings },
    { label: t.firstRun.openSessionsDir, run: () => api.openSessionsDir() },
    {
      label: t.firstRun.fullscreen,
      hint: hintFor('fullscreen'),
      separatorBefore: true,
      run: () => void api.window.toggleFullScreen(),
    },
    { label: t.firstRun.devTools, run: () => api.window.toggleDevTools() },
    { label: t.firstRun.quit, separatorBefore: true, run: () => api.window.close() },
  ]
}

const appBar = createAppBar(shell, {
  items: commandItems,
  onToggleSidebar: () => toggleSidebar(),
  sidebarVisible: () => sidebar.visible,
  onSplit: (side) => {
    current()?.splitFocused(side)
    appBar.syncControls()
  },
  onAddColumn: (side) => {
    current()?.addColumnBesideFocused(side)
    appBar.syncControls()
  },
  canSplit: () => current()?.canSplit() ?? false,
  hasSession: () => current() !== undefined,
  onSave: () => void saveCurrentLayout(),
  onPan: (delta, deltaMode) => current()?.panCanvas(delta, deltaMode),
  barPans: () => settings.barPanning === 1,
  hint: hintFor,
})
shell.prepend(appBar.element)

// ── Sidebar ─────────────────────────────────────────────

const sidebar = createSessionSidebar(workspace, {
  onOpen: (id) => void openSession(id),
  onClose: (id) => endSession(id),
  onCreateExample: () => void api.createExampleSession().then(() => refreshSidebar()),
  onRefresh: () => void refreshSidebar(),
  onWidthChange: (width) => void saveSettings({ ...settings, sidebarWidth: width }),
  onCreateBlank: () => openNewSession(),
  // The list numbers rows 1-9; the modifier is whatever that action is bound to.
  gotoHint: (index) => {
    const chord = bindings['goto-session'][0]
    return chord === undefined ? '' : formatChord(chord, IS_MAC).replace('1~9', String(index + 1))
  },
  onContextMenu: (at, sessionId) => {
    appBar.closeMenus()
    sidebarMenu.open(at, sidebarMenuItems(sessionId))
  },
  onRename: (id, newName) => void renameSession(id, newName),
  onReorder: (id, toIndex) => {
    void api.reorderSession(id, toIndex).then((list) => {
      knownSessions = list
      renderSidebar()
    })
  },
})

/**
 * Sidebar context menu: session commands over a row, list commands over empty
 * space.
 */
const sidebarMenu = createCommandMenu()

function sidebarMenuItems(sessionId: string | null): readonly CommandItem[] {
  if (sessionId === null) {
    return [
      { label: t.firstRun.newSession, run: openNewSession },
      { label: t.firstRun.refreshList, separatorBefore: true, run: () => void refreshSidebar() },
      { label: t.firstRun.openSessionsDir, run: () => api.openSessionsDir() },
    ]
  }

  const running = runtimes.has(sessionId)
  return [
    { label: running && sessionId === currentName ? t.firstRun.viewing : t.firstRun.open, disabled: running && sessionId === currentName, run: () => void openSession(sessionId) },
    {
      label: t.firstRun.endSession,
      disabled: !running,
      run: () => endSession(sessionId),
    },
    /*
     * Only over the row that is actually on screen. Anywhere else it would read
     * as "write my layout into that session", which is a different command and
     * one nobody asked for. Shown disabled rather than hidden, so the rule —
     * this belongs to the session you are looking at — is visible.
     */
    {
      label: t.firstRun.saveLayout,
      disabled: sessionId !== currentName,
      run: () => void saveCurrentLayout(),
    },
    { label: t.firstRun.editSessionFile, run: () => void editSessionFile(sessionId) },
    { label: t.firstRun.renameSession, run: () => sidebar.startRename(sessionId) },
    { label: t.firstRun.newSession, separatorBefore: true, run: openNewSession },
    { label: t.firstRun.openSessionsDir, run: () => api.openSessionsDir() },
    { label: t.firstRun.deleteSession, separatorBefore: true, danger: true, run: () => confirmDelete(sessionId) },
  ]
}

/** Rename a session. The file follows the name, so the id can change under us. */
async function renameSession(id: string, newName: string): Promise<void> {
  const result = await api.renameSession(id, newName)
  if (!result.ok) {
    toast.show(result.error ?? t.firstRun.renameFailedToast)
    return
  }
  // Main decides the file name; read the id back rather than deriving it twice.
  const newId = result.file.replace(/\.ya?ml$/, '').split('/').pop() ?? id
  if (newId !== id) {
    const runtime = runtimes.get(id)
    if (runtime !== undefined) {
      runtimes.delete(id)
      runtimes.set(newId, runtime)
    }
    const host = hosts.get(id)
    if (host !== undefined) {
      hosts.delete(id)
      hosts.set(newId, host)
    }
    if (currentName === id) currentName = newId
    if (previousName === id) previousName = newId
    for (const [was, now] of renamedIds) if (now === id) renamedIds.set(was, newId)
    renamedIds.set(id, newId)
  }
  runtimes.get(newId)?.rename(newName)
  if (newId === currentName) {
    setTitle(newName, runtimes.get(newId)?.focusedPaneTitle() ?? null)
  }
  await refreshSidebar()
}

/**
 * Delete a session: ask, then move to the trash. Being reversible is what
 * makes it acceptable one right-click away.
 */
function confirmDelete(sessionId: string): void {
  const summary = knownSessions.find((s) => s.id === sessionId)
  askConfirm(
    {
      title: t.firstRun.deleteTitle,
      items: [{ name: summary?.name ?? sessionId, paneCount: summary?.paneCount ?? 0 }],
      lead: t.firstRun.deleteLead(sessionId),
      confirmLabel: t.firstRun.deleteConfirm,
    },
    () => {
      confirmView.close()
      endSession(sessionId)
      void api.deleteSession(sessionId).then((result) => {
        toast.show(result.ok ? t.firstRun.deletedToast : (result.error ?? t.firstRun.deleteFailedToast))
        void refreshSidebar()
      })
    },
  )
}

/** Open a session's YAML in a new pane running $EDITOR. */
async function editSessionFile(id: string): Promise<void> {
  appBar.closeMenus()
  sidebarMenu.close()
  const runtime = current()
  if (runtime === undefined) {
    // Nowhere to put a pane — hand the file to the OS instead.
    api.openSessionFileExternal(id)
    return
  }
  const command = await api.editorCommandFor(id)
  if (command === null) {
    toast.show(t.firstRun.sessionFileMissing)
    return
  }
  runtime.openCommandPane(command)
}

function openNewSession(): void {
  for (const r of runtimes.values()) r.setActive(false)
  appBar.closeMenus()
  sidebarMenu.close()
  saveSessionView.openBlank()
}

function toggleSidebar(): void {
  const next = !sidebar.visible
  sidebar.setVisible(next)
  appBar.setSidebarVisible(next)
  void saveSettings({ ...settings, sidebarVisible: next ? 1 : 0 })
  // Width changed; remeasure without moving the view.
  current()?.relayout()
}

/** Last known session list, read by the context menu and by Alt+N. */
let knownSessions: readonly SessionSummary[] = []

/**
 * The session we were on before this one.
 *
 * Alt+N on the session you are already in goes back here. Switching between two
 * sessions is the common case, and it should not cost a second shortcut.
 */
let previousName: string | null = null

/** Where a renamed session went, for the ids closures captured before it. */
const renamedIds = new Map<string, string>()

/** How many panes a runtime holds right now, splits and closes included. */
function livePaneCount(runtime: SessionRuntime): number {
  return runtime.snapshot().columns.reduce((sum, c) => sum + c.panes.length, 0)
}

/**
 * Redraw from what is already known.
 *
 * Splitting changes no file, so re-reading the list would report the old count.
 */
function renderSidebar(): void {
  const live = new Map([...runtimes].map(([id, runtime]) => [id, livePaneCount(runtime)]))
  const wanting = new Set(
    [...runtimes].filter(([, runtime]) => runtime.wantsAttention()).map(([id]) => id),
  )
  sidebar.render(knownSessions, live, currentName, wanting)
}

/**
 * Tell main which pane is actually being watched.
 *
 * It decides whether a program's notification reaches the desktop, and window
 * focus cannot answer that here: the other nineteen panes are off screen, and
 * the sessions behind this one keep running.
 */
function reportWatchedPane(): void {
  const runtime = currentName === null ? undefined : runtimes.get(currentName)
  api.setVisiblePane(runtime?.watchedPaneId() ?? null)
}

/*
 * A pane rang. main watches the pty itself, so this arrives even for a pane
 * that is off screen and frozen — which is the pane it matters for.
 */
api.onAttention((attention) => {
  for (const runtime of runtimes.values()) {
    if (runtime.noteAttention(attention.paneId)) return
  }
})

/** Which session holds a pane. Null once its session has ended. */
function sessionOwningPane(paneId: string): string | null {
  for (const [id, runtime] of runtimes) {
    for (const column of runtime.snapshot().columns) {
      for (const pane of column.panes) if (pane.paneId === paneId) return id
    }
  }
  return null
}

/*
 * A desktop notification was clicked. main has already brought the window
 * forward; the pane still has to be found, since it may be off screen or in a
 * session that is not the one on display.
 */
api.onFocusPane((paneId) => {
  const owner = sessionOwningPane(paneId)
  if (owner === null) return
  void openSession(owner).then(() => {
    runtimes.get(owner)?.focusPane(paneId)
  })
})

/*
 * Copy or Paste came from the mac application menu.
 *
 * mac only, and not a second route for the same keys: Electron resolves Cmd+C/V
 * against the menu accelerator before the page sees them, so there the keydown
 * never reaches the keymap and this is the only delivery path. A chrome text
 * field is served here, since the browser's own edit commands lose the
 * accelerator too; anywhere else the focus is a terminal, and the session runs
 * the same action the shortcut runs on Linux.
 */
api.onMenuAction((action) => {
  const field = asTextField(document.activeElement)
  if (field !== null) {
    const start = field.selectionStart ?? 0
    const end = field.selectionEnd ?? start
    if (action === 'copy') {
      const text = selectedText(field.value, start, end)
      if (text !== '') api.writeClipboard(text)
      return
    }
    // Copying out of a read-only field is fine; writing into one is not.
    if (field.readOnly) return
    void api.readClipboard().then((text) => {
      if (text === '') return
      const next = withPasted(field.value, start, end, text)
      field.value = next.value
      field.setSelectionRange(next.caret, next.caret)
      // The views react to input events; a value set from script fires none.
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    return
  }
  // A dialog in front owns the keys, as it does in onAppKeyDown.
  if (settingsView.visible || saveSessionView.visible || confirmView.visible) return
  if (action === 'copy') current()?.copySelection()
  else current()?.pasteIntoFocused()
})

async function refreshSidebar(): Promise<void> {
  knownSessions = await api.listSessions()
  renderSidebar()
}

// ── Settings ────────────────────────────────────────────

/**
 * Put a whole settings object into effect. Writing it is saveSettings' job.
 *
 * `settings` is assigned first because currentTheme() reads it.
 */
function applySettings(next: AppSettings): void {
  settings = next
  applyIdleDim(next.idleDim)
  syncPeek()
  applyUiScale(next.uiScale)
  applyTerminalBackground(currentTheme())
  applyFocusBorder(next, currentTheme())
  appBar.syncControls()
  for (const runtime of runtimes.values()) runtime.applySettings(next)
}

/** Write, then apply what was actually stored — main may clamp a value. */
async function saveSettings(next: AppSettings): Promise<void> {
  applySettings(await api.saveSettings(next))
}

function applyBindings(next: Bindings): void {
  bindings = next
  // The ☰ menu prints the chords, so it is now showing the old ones.
  appBar.syncControls()
  placeholder.setBindings(next)
}

const settingsView = createSettingsView(canvasHost, {
  settings: () => settings,
  bindings: () => bindings,
  onPreview: applySettings,
  onChange: saveSettings,
  onBindingsChange: async (next) => {
    applyBindings(next)
    // Chords may come back dropped, so keep what was actually stored.
    applyBindings(await api.saveKeybindings(next))
  },
  userThemes: () => userThemes,
  refreshUserThemes,
  onDismiss: () => {
    settingsView.close()
    if (currentName !== null) {
      runtimes.get(currentName)?.setActive(true)
      // Settings merely covered the canvas; closing must not move the view.
      runtimes.get(currentName)?.relayout()
    }
  },
})

// ── Save session ────────────────────────────────────────

const saveSessionView = createSaveSessionView(canvasHost, {
  onSaved: (file, wasBlank) => {
    closeSaveSession()
    void refreshSidebar()
    // Open a new blank session straight away rather than making it a second step.
    if (wasBlank) {
      void openSession(file.replace(/\.ya?ml$/, '').split('/').pop() ?? '')
      return
    }
    // The title names the current session; a passing notice must not borrow it.
    toast.show(t.firstRun.saved(file.split('/').pop() ?? file))
  },
  onDismiss: () => closeSaveSession(),
})

/** ~-shorten for display; main expands it back on save. */
function shortenHome(path: string): string {
  return shorten(path, home)
}

/**
 * Save over the open session's own file, without asking anything.
 *
 * It writes by *id*, not by display name. The dialog derives a file name from
 * the name typed into it, which is the right rule there and the wrong one here:
 * a session whose YAML `name:` differs from its file name would be "overwritten"
 * into a second file, silently, since the derived name is not taken. The id is
 * the key this runtime is filed under, so nothing has to be derived at all.
 *
 * A previous generation is kept as `.bak` by the writer, which is what makes an
 * unprompted overwrite acceptable.
 */
async function saveCurrentLayout(): Promise<void> {
  const runtime = current()
  if (runtime === undefined || currentName === null) return
  appBar.closeMenus()
  const result = await api.saveSessionAs(
    currentName,
    runtime.spec.name,
    runtime.snapshot(),
    true,
    shortenHome(runtime.spec.cwd),
  )
  if (!result.ok) {
    toast.show(result.error ?? t.firstRun.saveFailed)
    return
  }
  await refreshSidebar()
  // Nothing on screen changes, so the notice has to carry when it will.
  toast.show(t.firstRun.savedLayout(result.file.split('/').pop() ?? result.file))
}

async function openSaveSession(): Promise<void> {
  const runtime = current()
  if (runtime === undefined) return
  // No session takes keys while this is open.
  for (const r of runtimes.values()) r.setActive(false)
  appBar.closeMenus()
  /*
   * A file that named a root keeps it; a root of ~ names nothing, so suggest
   * where the live shells actually stand instead of making the user type it.
   */
  const paneIds = runtime.snapshot().columns.flatMap((c) => c.panes.map((p) => p.paneId))
  const rootCwd =
    runtime.spec.cwd === home
      ? await api.suggestRootCwd(paneIds)
      : shortenHome(runtime.spec.cwd)
  saveSessionView.open(runtime.spec.name, rootCwd, () => runtime.snapshot())
}

function closeSaveSession(): void {
  saveSessionView.close()
  if (currentName !== null) {
    runtimes.get(currentName)?.setActive(true)
    runtimes.get(currentName)?.relayout()
  }
}

function openSettings(): void {
  // No session takes keys while this is open.
  for (const runtime of runtimes.values()) runtime.setActive(false)
  // No dropdown may remain above the settings.
  appBar.closeMenus()
  settingsView.open()
}

// ── Close confirmation ──────────────────────────────────

/*
 * Every close path arrives here. Without detach, closing kills every process
 * inside, so it asks — but only when there is something to lose.
 */
const confirmView = createConfirmCloseView(canvasHost, {
  onCancel: () => {
    confirmView.close()
    if (currentName !== null) {
      runtimes.get(currentName)?.setActive(true)
      runtimes.get(currentName)?.relayout()
    }
  },
})

api.window.onCloseRequested(() => {
  const running = [...runtimes.values()].map((runtime) => ({
    name: runtime.spec.name,
    paneCount: livePaneCount(runtime),
  }))
  if (running.length === 0) {
    api.window.confirmClose()
    return
  }
  askConfirm({
    title:
      running.length === 1
        ? t.firstRun.closeOneRunning
        : t.firstRun.closeManyRunning(String(running.length)),
    items: running,
    lead: t.firstRun.closeLead,
    confirmLabel: t.firstRun.closeConfirm,
  }, () => api.window.confirmClose())
})

/** No session takes keys while a dialog is up. */
function askConfirm(request: ConfirmRequest, onConfirm: () => void): void {
  for (const runtime of runtimes.values()) runtime.setActive(false)
  appBar.closeMenus()
  sidebarMenu.close()
  confirmView.ask(request, onConfirm)
}

/*
 * Peek: while the move modifier is held, every pane on screen says its title.
 *
 * Held state is tracked rather than read off each event, so an Alt+Arrow chord
 * keeps the labels up for as long as the key is down. Blur ends it: a keyup
 * delivered to another window would otherwise leave them on screen forever.
 */
let peeking = false

/*
 * The key state and the labels are kept apart so that turning the setting off
 * mid-hold clears them at once, and turning it back on brings them straight
 * back without waiting for the modifier to be pressed again.
 */
function syncPeek(): void {
  canvasHost.classList.toggle('canvas--peek', peeking && settings.paneLabels === 1)
}

function applyPeek(event: PeekEvent): void {
  const next = nextPeek(peeking, event, IS_MAC)
  if (next === peeking) return
  peeking = next
  syncPeek()
}

window.addEventListener('keydown', (event) => applyPeek({ t: 'keydown', code: event.code }), true)
window.addEventListener('keyup', (event) => applyPeek({ t: 'keyup', code: event.code }), true)
window.addEventListener('blur', () => applyPeek({ t: 'blur' }))

// ── App shortcuts ───────────────────────────────────────

/*
 * Sidebar, settings and fullscreen belong to the app, not a session — they
 * still mean something with nothing open, so nothing else can own them.
 */
function onAppKeyDown(event: KeyboardEvent): void {
  // A dialog in front owns the keys; each handles its own Esc.
  if (settingsView.visible || saveSessionView.visible || confirmView.visible) return
  const action = resolveAction(event, bindings, IS_MAC)
  if (action === null || !isAppAction(action)) return
  event.preventDefault()
  event.stopPropagation()

  switch (action.t) {
    case 'goto-session':
      gotoSession(action.index)
      break
    case 'step-session':
      stepToSession(action.delta)
      break
    case 'toggle-sidebar':
      toggleSidebar()
      break
    case 'settings':
      openSettings()
      break
    case 'save-layout':
      void saveCurrentLayout()
      break
    case 'fullscreen':
      void api.window.toggleFullScreen()
      break
    // The main process clamps to the settings screen's bounds, so no limit here.
    case 'font-size':
      void saveSettings({ ...settings, fontSize: settings.fontSize + action.delta })
      break
    case 'font-reset':
      void saveSettings({ ...settings, fontSize: 13 })
      break
  }
}
window.addEventListener('keydown', onAppKeyDown, true)

/**
 * Alt+N: open the nth session in the sidebar, or go back if already there.
 *
 * The index follows what the list shows, so the shortcut means what the eye
 * sees. Beyond the ninth there is no shortcut — the list is right there.
 */
function gotoSession(index: number): void {
  const target = knownSessions[index]
  if (target === undefined) return
  if (target.id === currentName) {
    if (previousName !== null) void openSession(previousName)
    return
  }
  if (target.error !== null) return
  void openSession(target.id)
}

/**
 * Alt+Shift+< / >: the session before or after this one.
 *
 * Only what is already running, so the key never spawns a shell — it moves
 * between the ones you are working in, the way a tab strip does.
 */
function stepToSession(delta: 1 | -1): void {
  const running = knownSessions.filter((s) => runtimes.has(s.id)).map((s) => s.id)
  const target = stepSession(running, currentName, delta)
  if (target !== null) void openSession(target)
}

// ── Sessions ────────────────────────────────────────────

/**
 * The bar shows the session and nothing else — the app's own name there says
 * nothing you don't already know. It stays in the window title, which is what
 * the taskbar reads.
 */
function setTitle(session: string | null, paneTitle: string | null = null): void {
  // The taskbar keeps naming the session alone: a pane title changes with every
  // focus move, and a window entry that renames itself that often is noise.
  document.title = session === null ? t.firstRun.appName : t.firstRun.windowTitle(session)
  appBar.setTitle(session === null ? '' : barTitle(session, paneTitle, t.appBar.titleWithPane))
}

function showOnly(name: string | null): void {
  // Remember where we came from, so Alt+N can bounce back.
  if (currentName !== null && currentName !== name) previousName = currentName
  for (const [key, element] of hosts) element.hidden = key !== name
  // Every other session first: leaving means giving up WebGL contexts, and the
  // arriving session needs them free before it asks for its own.
  for (const [key, runtime] of runtimes) if (key !== name) runtime.setActive(false)
  if (name !== null) runtimes.get(name)?.setActive(true)
  currentName = name
  // setActive above ran while currentName still named the session being left,
  // so the report it triggered was for the wrong one. Say it again, correctly.
  reportWatchedPane()
  syncPlaceholder()
  revealListWhenEmpty()
  appBar.syncControls()
  if (name === null) setTitle(null)
}

function endSession(from: string): void {
  // A rename moves a session to a new id, and the runtime's own onEnd closure
  // was made before that; follow the trail rather than leaking a dead session.
  const id = renamedIds.get(from) ?? from
  // Ending a session from the list also means returning to the canvas.
  dismissOverlays()
  runtimes.get(id)?.destroy()
  runtimes.delete(id)
  hosts.get(id)?.remove()
  hosts.delete(id)
  if (previousName === id) previousName = null
  for (const [was, now] of renamedIds) if (now === id) renamedIds.delete(was)

  if (currentName === id) {
    // If it was the visible one, move to whatever remains.
    const next = runtimes.keys().next()
    showOnly(next.done === true ? null : next.value)
    const runtime = current()
    if (runtime !== undefined) {
      runtime.refresh()
    }
  }
  void refreshSidebar()
}

/** id is the file name without extension, not the display name. */
/**
 * Dismiss whatever is in front.
 *
 * These dialogs cover the canvas but not the sidebar, so a session can be
 * picked while one is open — it must come forward, not open behind.
 */
function dismissOverlays(): void {
  settingsView.close()
  saveSessionView.close()
  confirmView.close()
}

async function openSession(id: string): Promise<void> {
  dismissOverlays()
  const existing = runtimes.get(id)
  if (existing !== undefined) {
    showOnly(id)
    // refresh publishes the title, pane part included.
    existing.refresh()
    void refreshSidebar()
    return
  }

  const loaded = await api.loadSession(id)
  if (!loaded.ok || loaded.spec === null) {
    await refreshSidebar()
    return
  }

  const element = document.createElement('div')
  element.className = 'session-host'
  canvasHost.append(element)
  hosts.set(id, element)

  runtimes.set(
    id,
    startSession({
      spec: loaded.spec,
      file: loaded.file,
      host: element,
      settings: () => settings,
      bindings: () => bindings,
      theme: currentTheme,
      onTitle: setTitle,
      onCopied: (chars) => toast.show(t.firstRun.copied(String(chars))),
      onPanesChanged: renderSidebar,
      // The same write as Alt+Shift+S: a title lives in the layout, so the
      // whole layout is what there is to save.
      onPaneRenamed: () => void saveCurrentLayout(),
      onAttentionChanged: renderSidebar,
      onWatchedPaneChanged: reportWatchedPane,
      onEnd: () => endSession(id),
    }),
  )
  showOnly(id)
  void refreshSidebar()
}

// ── Startup ─────────────────────────────────────────────

async function boot(): Promise<void> {
  settings = await api.getSettings()
  applyBindings(await api.getKeybindings())
  home = await api.userHome()
  // Before any session, or the first pane flashes the default palette.
  await refreshUserThemes()
  applySettings(settings)
  sidebar.setWidth(settings.sidebarWidth)
  sidebar.setVisible(settings.sidebarVisible === 1)
  appBar.setSidebarVisible(settings.sidebarVisible === 1)
  syncPlaceholder()
  revealListWhenEmpty()
  appBar.syncControls()
  await refreshSidebar()
}

void boot()

/*
 * A file dropped anywhere but a terminal is refused rather than opened.
 * Chromium's default is to navigate to it, which would replace the app with the
 * file's contents and end the session.
 */
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (event) => event.preventDefault())
}

// Self-check, started by `npm run verify:app`. Stripped from production builds:
// nothing sets the flag there, so this folds to false.
if (import.meta.env.VITE_SELFCHECK === '1') {
  void import('./self-check').then((module) => module.run())
}
