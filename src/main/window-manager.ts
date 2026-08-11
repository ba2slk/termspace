import { app, BrowserWindow, Menu, screen, shell } from 'electron'
import { join } from 'node:path'
import { APP_NAME } from '../shared/version'
import { stringsFor } from '../shared/ui-strings'

/**
 * Where a self-check window sits, so several can run at once.
 *
 * SELFCHECK_TILE is "index/count". The windows tile across the work area rather
 * than stacking, because a covered window stops compositing: no frames means no
 * inertia to measure and a screenshot of whatever was drawn last.
 */
function selfCheckBounds(): Electron.Rectangle | null {
  const tile = process.env['SELFCHECK_TILE']
  if (tile === undefined) return null
  const [index, count] = tile.split('/').map(Number)
  if (index === undefined || count === undefined || count < 1) return null

  const area = screen.getPrimaryDisplay().workArea
  const columns = count <= 2 ? count : 2
  const rows = Math.ceil(count / columns)
  const width = Math.floor(area.width / columns)
  const height = Math.floor(area.height / rows)
  return {
    x: area.x + (index % columns) * width,
    y: area.y + Math.floor(index / columns) * height,
    width,
    height,
  }
}

/**
 * Write to stdout without letting a closed pipe kill the app.
 *
 * If the parent terminal goes away, later writes throw EPIPE, and an unhandled
 * exception in main becomes an Electron error dialog.
 */
function safeWrite(stream: NodeJS.WriteStream, text: string): void {
  try {
    stream.write(text)
  } catch {
    // Pipe closed — nowhere to log
  }
}

/** Time for the compositor to drop the surface before it is mapped again. */
const REMAP_DELAY_MS = 60

/**
 * Bring the window forward from a background event.
 *
 * show()/focus()/moveTop()/setAlwaysOnTop() are all refused under Wayland's
 * focus-stealing prevention, which only trusts a *new* surface with focus.
 * Unmapping and remapping produces one, and is the only sequence that was
 * measured to work; see docs/engineering-notes.md. A window that already has
 * focus is left alone — there is nothing to raise, and the remap would show as
 * a flash.
 */
export function activateWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  // Nothing to win against focus-stealing prevention when we already have focus,
  // and the remap below would flash the window for no reason.
  if (win.isFocused()) return
  if (win.isMinimized()) win.restore()
  if (process.platform !== 'linux') {
    win.show()
    win.focus()
    return
  }
  win.hide()
  setTimeout(() => {
    if (win.isDestroyed()) return
    win.show()
    win.focus()
  }, REMAP_DELAY_MS)
}

/**
 * The mac application menu.
 *
 * mac reserves Cmd+Q/H/M/W for the menu bar, so an app without one cannot quit
 * or hide from the keyboard. Those come from the roles, which the OS labels in
 * its own language; only the labels written here need the catalogue.
 *
 * Copy and Paste are custom rather than roles: a role acts on the document
 * selection, and xterm draws to a canvas, so selected terminal text is
 * invisible to it. These forward to the renderer, which already knows how to
 * reach the terminal — and Electron matches an accelerator against the menu
 * before the page sees the key, so this is the delivery path for Cmd+C/V.
 */
function applicationMenu(locale: string): Menu {
  // An empty locale means "follow the system", as it does in the renderer,
  // where navigator.language stands in for app.getLocale().
  const t = stringsFor(locale === '' ? app.getLocale() : locale).appMenu
  // A click's window is typed as BaseWindow, which has no renderer to send to.
  const forward = (win: Electron.BaseWindow | undefined, action: 'copy' | 'paste'): void => {
    if (win instanceof BrowserWindow) win.webContents.send('menu-action', action)
  }
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    // Cmd+W lives on the `close` role, which mac keeps in the File menu — the
    // windowMenu role does not carry it, so without this the key does nothing.
    { label: t.file, submenu: [{ role: 'close' }] },
    {
      label: t.edit,
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { label: t.copy, accelerator: 'Cmd+C', click: (_item, win) => forward(win, 'copy') },
        { label: t.paste, accelerator: 'Cmd+V', click: (_item, win) => forward(win, 'paste') },
        { role: 'selectAll' },
      ],
    },
    { role: 'windowMenu' },
  ])
}

export function createMainWindow(locale: string): BrowserWindow {
  // The app draws its own title bar; on Linux the menu bar is unused entirely.
  Menu.setApplicationMenu(process.platform === 'darwin' ? applicationMenu(locale) : null)

  const tile = selfCheckBounds()
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    ...(tile ?? {}),
    minWidth: 640,
    minHeight: 400,
    title: APP_NAME,
    // The app draws its own title bar, reclaiming the menu bar's row for the
    // canvas. On mac the native traffic lights float over that row instead of a
    // drawn set: hiddenInset places them, and the row itself stays ours.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : { frame: false as const }),
    // Mirrors --bg-canvas in tokens.css (main cannot read CSS); change both together.
    backgroundColor: '#141414',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // pty output keeps arriving while the window is in the background, so the
      // usual throttling of timers and rAF would stall rendering and inertia.
      backgroundThrottling: false,
    },
  })

  // Show after first paint to avoid a white flash.
  win.once('ready-to-show', () => win.show())

  // A link opened in-app would turn the renderer into an arbitrary page. Hand it
  // to the external browser, and only for known schemes — these URLs come from
  // program output, and file:// or custom schemes can launch anything.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const scheme = new URL(url).protocol
      if (scheme === 'http:' || scheme === 'https:' || scheme === 'mailto:') {
        void shell.openExternal(url)
      }
    } catch {
      // Not a URL — don't open
    }
    return { action: 'deny' }
  })

  /*
   * Which group of checks to run, read by the renderer from the URL. It cannot
   * come from import.meta.env: that is baked at build time, and every process
   * here runs the same bundle.
   */
  const scope = process.env['SELFCHECK_SCOPE']
  /*
   * The locale rides along for the same reason. Every screen bakes its strings
   * in as it is built, so the renderer has to know the language before its
   * first module runs — earlier than any answer over IPC could arrive.
   */
  const query: Record<string, string> = {}
  if (scope !== undefined) query['scope'] = scope
  if (locale !== '') query['locale'] = locale

  const devUrl = process.env['ELECTRON_RENDERER_URL']

  /*
   * Forward the renderer console to stdout.
   *
   * Also for the self-check, which runs against a build: its whole report is
   * printed from the renderer, and without this the runner sees nothing and
   * waits out its timeout while the windows quietly finish and close.
   */
  if (devUrl !== undefined || scope !== undefined) {
    win.webContents.on('console-message', (details) => {
      safeWrite(process.stdout, `[renderer:${details.level}] ${details.message}\n`)
    })
    win.webContents.on('render-process-gone', (_e, details) => {
      safeWrite(process.stderr, `[renderer] process gone: ${JSON.stringify(details)}\n`)
    })
  }

  if (devUrl !== undefined) {
    const search = new URLSearchParams(query).toString()
    void win.loadURL(search === '' ? devUrl : `${devUrl}?${search}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
  return win
}
