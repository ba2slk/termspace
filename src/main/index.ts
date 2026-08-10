import { app, dialog } from 'electron'
import { loadSettingsSync } from './app-settings'
import { registerIpcHandlers } from './ipc-bridge'
import { createPtyHost, type PtyHost } from './pty-host'
import { writeShellIntegrationFile } from './shell-integration'
import { activateWindow, createMainWindow } from './window-manager'

// Run natively on Wayland; ignored on X11. Without it we fall back to
// XWayland, which hurts HiDPI scaling and IME behaviour.
app.commandLine.appendSwitch('ozone-platform-hint', 'auto')

// If the launching terminal closes, later writes throw EPIPE and an unhandled
// exception in main becomes an error dialog. Losing a log line is harmless.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', () => undefined)
}

/**
 * The self-check has to run while the user's own window is open, so it skips
 * the single-instance lock and uses a separate user-data folder.
 */
const isSelfCheck = process.env['VITE_SELFCHECK'] === '1'
if (isSelfCheck) {
  // Per process: parallel groups must not share a user-data folder.
  const id = process.env['SELFCHECK_SCOPE'] ?? 'all'
  app.setPath('userData', `${app.getPath('temp')}/termspace-selfcheck-${id}`)
}

// A second instance would open a second copy of the same session's ptys.
if (!isSelfCheck && !app.requestSingleInstanceLock()) {
  // Say so on the way out. Quitting silently exits 0 with no window, which from
  // a terminal is indistinguishable from a build that produced nothing —
  // `npm run dev` against an installed copy loses an hour to this.
  process.stderr.write('Termspace is already running. Bringing that window to the front.\n')
  app.quit()
} else {
  void app.whenReady().then(() => {
    let host: PtyHost
    try {
      host = createPtyHost()
    } catch (err) {
      // Native ABI mismatch is the most common install failure here.
      dialog.showErrorBox(
        'Termspace could not start',
        'Failed to load node-pty. It must be rebuilt against the Electron ABI.\n\n' +
          '  npm run postinstall\n\n' +
          `Cause: ${err instanceof Error ? err.message : String(err)}`,
      )
      app.quit()
      return
    }

    // Refreshed every launch so an upgrade updates the hook on its own. A
    // failure here only costs the alias-aware save, so it must not block start.
    void writeShellIntegrationFile(process.env).catch((err: unknown) => {
      process.stderr.write(
        `Could not write the shell integration hook: ${err instanceof Error ? err.message : String(err)}\n`,
      )
    })

    const win = createMainWindow(loadSettingsSync(process.env).locale)
    const unregister = registerIpcHandlers(win, host, process.env)

    // The launch that lost the lock has quit by now. Surface this window, or
    // the second launch looks like nothing happened at all.
    app.on('second-instance', () => activateWindow(win))

    // Closing the app ends its processes; detach is out of scope.
    app.on('before-quit', () => {
      unregister()
      host.killAll()
    })
  })

  app.on('window-all-closed', () => app.quit())
}
