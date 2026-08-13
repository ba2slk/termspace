/**
 * Routes renderer requests to pty-host and session-config, and batches pty output back.
 */
import { writeFile } from 'node:fs/promises'
import { clipboard, dialog, ipcMain, Notification, shell, type BrowserWindow } from 'electron'
import type {
  LayoutSnapshot,
  PaneAttention,
  LoadSessionResult,
  SaveSessionResult,
  SessionSummary,
  ShellIntegrationStatus,
  SpawnRequest,
  SpawnResult,
} from '../shared/protocol'
import { RC_LINE, RC_LINE_ZSH } from './shell-integration'
import { activateWindow } from './window-manager'
import { loadSettings, saveSettings, settingsFile } from './app-settings'
import { loadKeybindings, saveKeybindings } from './keybindings-file'
import { listMonoFonts } from './font-list'
import { ensureThemesDir, listUserThemes } from './theme-config'
import { OutputBatcher } from './output-batcher'
import { resolvePaneCommand } from './pane-command'
import type { PtyHost } from './pty-host'
import {
  createBlankSession,
  createExampleSession,
  listSessions,
  loadSession,
  renameSessionName,
  saveSession,
  sessionExists,
  sessionFilePath,
  sessionsDir,
} from './session-config'
import { APP_NAME } from '../shared/version'
import { shellQuote } from '../shared/shell-quote'
import { resolveCwd } from './session-schema'
import { deepestCommonAncestor, shorten, type SessionDraft } from './session-writer'

const FLUSH_INTERVAL_MS = 16
const HIGH_WATER_MARK_CHARS = 64 * 1024

const INVOKE_CHANNELS = [
  'session:list',
  'session:load',
  'session:create-example',
  'session:exists',
  'session:save-as',
  'session:create-blank',
  'session:delete',
  'session:rename',
  'session:editor-command',
  'fonts:list',
  'themes:list',
  'pty:spawn',
  'clipboard:read',
  'window:toggle-maximize',
  'window:toggle-fullscreen',
  'settings:get',
  'settings:save',
  'keybindings:get',
  'keybindings:save',
  'debug:capture',
  'debug:focus',
  'app:home',
  'session:suggest-root',
  'session:pick-directory',
  'shell-integration:status',
  'pty:foreground-commands',
  'pty:titles',
]
const ON_CHANNELS = [
  'pty:write',
  'pty:resize',
  'pty:kill',
  'clipboard:write',
  'session:reveal-dir',
  'session:open-external',
  'window:minimize',
  'window:close',
  'window:confirm-close',
  'window:toggle-devtools',
  'settings:reveal',
  'themes:reveal',
  'app:visible-pane',
]

export function registerIpcHandlers(
  win: BrowserWindow,
  host: PtyHost,
  env: NodeJS.ProcessEnv,
): () => void {
  const dir = sessionsDir(env)

  const send = (channel: string, ...args: unknown[]): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }

  /*
   * Read once and kept current on save. A notification must not wait on a file
   * read, and the value is wanted at the moment a program rings.
   */
  let notificationsOn = true
  void loadSettings(env).then((settings) => {
    notificationsOn = settings.notifications === 1
  })

  /** The pane the renderer says is being watched right now. */
  let visiblePaneId: string | null = null
  ipcMain.on('app:visible-pane', (_e, paneId: string | null) => {
    visiblePaneId = paneId
  })

  /**
   * A program asked to be noticed.
   *
   * The bell never reaches the desktop. bash rings it for an ambiguous tab
   * completion, so a desktop notification per bell would be constant noise —
   * it is shown inside the app and nowhere else. OSC 9 and OSC 777 are
   * deliberate, and only those are forwarded.
   *
   * "Did they see it?" is not the same question as "is the window focused?".
   * Panes sit off screen here by design, and a session that is not on screen
   * keeps running, so a focused window says nothing about whether *this* pane
   * was watched. The renderer names the one pane that was.
   */
  function announce(attention: PaneAttention): void {
    send('pty:attention', attention)
    if (attention.kind !== 'notify') return
    if (!notificationsOn || win.isDestroyed()) return
    const watched = win.isFocused() && attention.paneId === visiblePaneId
    if (watched) return
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: attention.title === '' ? APP_NAME : attention.title,
      body: attention.body,
    })
    /*
     * Clicking is the user saying "take me there". The window has to come
     * forward and the canvas has to travel to the pane that rang — it may be
     * off screen, or in a session that is not the one on display.
     */
    notification.on('click', () => {
      activateWindow(win)
      send('app:focus-pane', attention.paneId)
    })
    notification.show()
  }

  const batcher = new OutputBatcher({
    flushIntervalMs: FLUSH_INTERVAL_MS,
    highWaterMarkChars: HIGH_WATER_MARK_CHARS,
    onFlush: (paneId, data) => send('pty:data', paneId, data),
    onPause: (paneId) => host.pause(paneId),
    onResume: (paneId) => host.resume(paneId),
  })

  ipcMain.handle('session:list', (): Promise<SessionSummary[]> => listSessions(dir))
  ipcMain.handle(
    'session:load',
    (_e, name: string): Promise<LoadSessionResult> => loadSession(dir, name, env),
  )
  ipcMain.handle('session:create-example', (): Promise<string> => createExampleSession(dir))

  ipcMain.handle('session:exists', (_e, id: string): Promise<boolean> => sessionExists(dir, id))

  // Move to the trash rather than unlink, so the delete stays reversible.
  ipcMain.handle('session:delete', async (_e, id: string): Promise<SaveSessionResult> => {
    const path = await sessionFilePath(dir, id)
    if (path === null) return { ok: false, file: '', error: 'Session file not found' }
    try {
      await shell.trashItem(path)
      return { ok: true, file: path, error: null }
    } catch (err) {
      return { ok: false, file: path, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    'session:rename',
    (_e, id: string, newName: string): Promise<SaveSessionResult> =>
      renameSessionName(dir, id, newName),
  )

  ipcMain.handle('session:editor-command', async (_e, id: string): Promise<string | null> => {
    const path = await sessionFilePath(dir, id)
    if (path === null) return null
    // The shell decides what $EDITOR means; we only quote the path.
    // Empty string is conventionally "unset" for $EDITOR, so fall through with ||, not ??.
    const editor = env['EDITOR'] || env['VISUAL'] || 'vi'
    return `${editor} ${shellQuote(path)}`
  })

  ipcMain.on('session:open-external', (_e, id: string) => {
    void sessionFilePath(dir, id).then((path) => {
      if (path !== null) void shell.openPath(path)
    })
  })

  ipcMain.handle('fonts:list', (): Promise<string[]> => listMonoFonts())

  ipcMain.handle('themes:list', () => listUserThemes(env))
  ipcMain.on('themes:reveal', () => {
    // Create the folder with an example, so it is never opened empty.
    void ensureThemesDir(env).then((dir) => shell.openPath(dir))
  })

  ipcMain.handle(
    'session:create-blank',
    async (_e, id: string, displayName: string, rootCwd: string): Promise<SaveSessionResult> => {
      // Column width follows the setting; defining another default here would drift.
      const { defaultColumnWidth } = await loadSettings(env)
      return createBlankSession(dir, id, displayName, defaultColumnWidth, env['HOME'] ?? '', rootCwd)
    },
  )

  ipcMain.handle('app:home', () => env['HOME'] ?? '')

  ipcMain.handle(
    'shell-integration:status',
    (): ShellIntegrationStatus => ({
      rcLine: RC_LINE,
      rcLineZsh: RC_LINE_ZSH,
      active: host.hasIntegratedPane(),
    }),
  )

  ipcMain.handle('session:suggest-root', (_e, paneIds: readonly string[]): string => {
    const home = env['HOME'] ?? ''
    // Dead panes drop out; with nothing live left, home is the only safe guess.
    const cwds = paneIds.map((id) => host.cwdOf(id)).filter((cwd): cwd is string => cwd !== null)
    const ancestor = deepestCommonAncestor(cwds)
    return shorten(ancestor ?? (home === '' ? '/' : home), home)
  })

  /*
   * The folder chooser for a session's root.
   *
   * Modal to the window: a picker that can slip behind the app is worse than
   * none. The pick comes back `~`-shortened to match what the field already
   * holds, so a chosen path and a typed one are stored the same way.
   */
  ipcMain.handle('session:pick-directory', async (_e, current: string): Promise<string | null> => {
    const home = env['HOME'] ?? ''
    const start = current.trim() === '' ? '~' : current.trim()
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: resolveCwd(home, start, home),
    })
    const picked = result.filePaths[0]
    return result.canceled || picked === undefined ? null : shorten(picked, home)
  })

  /*
   * Write the layout to a session file.
   *
   * cwd is filled in here, not by the renderer: only this side holds the pty
   * and can see where the shell moved to.
   */
  ipcMain.handle(
    'session:save-as',
    async (
      _e,
      id: string,
      displayName: string,
      layout: LayoutSnapshot,
      overwrite: boolean,
      rootCwd: string,
    ): Promise<SaveSessionResult> => {
      const home = env['HOME'] ?? ''
      const draft: SessionDraft = {
        name: displayName,
        cwd: resolveCwd(home, rootCwd.trim() === '' ? '~' : rootCwd.trim(), home),
        columns: await Promise.all(
          layout.columns.map(async (column) => ({
            width: column.width,
            panes: await Promise.all(
              column.panes.map(async (pane) => {
                const liveCwd = host.cwdOf(pane.paneId)
                return {
                  title: pane.title,
                  command: resolvePaneCommand({
                    prefill: pane.prefill,
                    declaredCommand: pane.command,
                    submittedCommand: host.submittedCommandOf(pane.paneId),
                    foregroundCommand: await host.foregroundCommandOf(pane.paneId),
                    declaredCwd: pane.fallbackCwd,
                    liveCwd,
                    home,
                  }),
                  prefill: pane.prefill,
                  cwd: liveCwd ?? pane.fallbackCwd,
                  heightRatio: pane.heightRatio,
                }
              }),
            ),
          })),
        ),
      }
      return saveSession(dir, id, draft, overwrite, home)
    },
  )

  ipcMain.handle(
    'pty:spawn',
    (_e, request: SpawnRequest): SpawnResult =>
      host.spawn(request, {
        onData: (paneId, data) => batcher.push(paneId, data),
        onAttention: announce,
        onExit: (exit) => {
          // Flush before announcing the exit, or the dying process's last
          // error message never reaches the screen.
          batcher.flushPane(exit.paneId)
          send('pty:exit', exit)
        },
      }),
  )

  // A snapshot for the overview: what runs in each pane's foreground right now.
  ipcMain.handle(
    'pty:foreground-commands',
    async (_e, paneIds: readonly string[]): Promise<Record<string, string | null>> =>
      Object.fromEntries(
        await Promise.all(
          paneIds.map(async (id) => [id, await host.foregroundCommandOf(id)] as const),
        ),
      ),
  )

  // Window titles per pane (OSC 0/2), for the overview.
  ipcMain.handle(
    'pty:titles',
    (_e, paneIds: readonly string[]): Record<string, string | null> =>
      Object.fromEntries(paneIds.map((id) => [id, host.titleOf(id)])),
  )

  ipcMain.on('pty:write', (_e, paneId: string, data: string) => host.write(paneId, data))
  ipcMain.on('pty:resize', (_e, paneId: string, cols: number, rows: number) =>
    host.resize(paneId, cols, rows),
  )
  // The app draws its own title bar, so the renderer drives window controls.
  ipcMain.on('window:minimize', () => win.minimize())
  /*
   * Every close path — window button, menu, Alt+F4 — reaches win.close(), so
   * intercepting it here is enough to ask the renderer first.
   */
  let allowClose = false
  const onClose = (event: Electron.Event): void => {
    if (allowClose) return
    event.preventDefault()
    send('app:close-requested')
  }
  win.on('close', onClose)

  ipcMain.on('window:close', () => win.close())
  ipcMain.on('window:confirm-close', () => {
    allowClose = true
    win.close()
  })
  ipcMain.on('window:toggle-devtools', () => win.webContents.toggleDevTools())
  ipcMain.handle('window:toggle-maximize', (): boolean => {
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle('window:toggle-fullscreen', (): boolean => {
    win.setFullScreen(!win.isFullScreen())
    return win.isFullScreen()
  })
  const notifyMaximize = (): void => send('window:maximize-changed', win.isMaximized())
  win.on('maximize', notifyMaximize)
  win.on('unmaximize', notifyMaximize)

  ipcMain.on('session:reveal-dir', () => void shell.openPath(dir))

  ipcMain.handle('settings:get', () => loadSettings(env))
  ipcMain.handle('settings:save', async (_e, next: unknown) => {
    const saved = await saveSettings(env, next)
    notificationsOn = saved.notifications === 1
    return saved
  })
  ipcMain.handle('keybindings:get', () => loadKeybindings(env))
  ipcMain.handle('keybindings:save', (_e, next: unknown) => saveKeybindings(env, next))
  ipcMain.on('settings:reveal', () => {
    // Create it with defaults first, so "open" always opens something.
    void (async () => {
      await saveSettings(env, await loadSettings(env))
      await shell.openPath(settingsFile(env))
    })()
  })

  /*
   * Screenshots for the self-check. DOM queries can't see a layout that is
   * present and correctly classed but visually wrong.
   */
  if (env['VITE_SELFCHECK'] === '1') {
    ipcMain.handle('debug:capture', async (_e, path: string): Promise<string> => {
      const image = await win.webContents.capturePage()
      await writeFile(path, image.toPNG())
      return path
    })

    /* Raise the check window: wheel and clipboard can't be measured otherwise. */
    ipcMain.handle('debug:focus', (): boolean => {
      // Also pin on top: an occluded window stops compositing, so rAF stalls.
      win.setAlwaysOnTop(true)
      win.show()
      win.moveTop()
      win.focus()
      return win.isFocused()
    })
  }

  ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('clipboard:read', (): string => clipboard.readText())

  ipcMain.on('pty:kill', (_e, paneId: string) => {
    batcher.drop(paneId)
    host.kill(paneId)
  })

  return () => {
    win.off('close', onClose)
    win.off('maximize', notifyMaximize)
    win.off('unmaximize', notifyMaximize)
    batcher.dispose()
    for (const channel of INVOKE_CHANNELS) ipcMain.removeHandler(channel)
    for (const channel of ON_CHANNELS) ipcMain.removeAllListeners(channel)
  }
}
