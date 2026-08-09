import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { PaneAttention, PtyExit, SpawnRequest, TermspaceApi } from '../shared/protocol'

/**
 * The only path from renderer to main. No logic here — it would run on the same
 * page as arbitrary program output.
 */
const api: TermspaceApi = {
  listSessions: () => ipcRenderer.invoke('session:list'),
  loadSession: (name) => ipcRenderer.invoke('session:load', name),
  createExampleSession: () => ipcRenderer.invoke('session:create-example'),
  sessionExists: (id) => ipcRenderer.invoke('session:exists', id),
  saveSessionAs: (id, displayName, layout, overwrite, rootCwd) =>
    ipcRenderer.invoke('session:save-as', id, displayName, layout, overwrite, rootCwd),
  createBlankSession: (id, displayName, rootCwd) =>
    ipcRenderer.invoke('session:create-blank', id, displayName, rootCwd),
  userHome: () => ipcRenderer.invoke('app:home'),
  suggestRootCwd: (paneIds) => ipcRenderer.invoke('session:suggest-root', paneIds),
  pickDirectory: (current) => ipcRenderer.invoke('session:pick-directory', current),
  shellIntegrationStatus: () => ipcRenderer.invoke('shell-integration:status'),
  deleteSession: (id) => ipcRenderer.invoke('session:delete', id),
  editorCommandFor: (id) => ipcRenderer.invoke('session:editor-command', id),
  openSessionFileExternal: (id) => ipcRenderer.send('session:open-external', id),
  listMonoFonts: () => ipcRenderer.invoke('fonts:list'),
  listUserThemes: () => ipcRenderer.invoke('themes:list'),
  openThemesDir: () => ipcRenderer.send('themes:reveal'),
  spawn: (request: SpawnRequest) => ipcRenderer.invoke('pty:spawn', request),
  foregroundCommands: (paneIds) => ipcRenderer.invoke('pty:foreground-commands', paneIds),
  paneTitles: (paneIds) => ipcRenderer.invoke('pty:titles', paneIds),
  setVisiblePane: (paneId) => ipcRenderer.send('app:visible-pane', paneId),
  write: (paneId, data) => ipcRenderer.send('pty:write', paneId, data),
  resize: (paneId, cols, rows) => ipcRenderer.send('pty:resize', paneId, cols, rows),
  kill: (paneId) => ipcRenderer.send('pty:kill', paneId),
  writeClipboard: (text) => ipcRenderer.send('clipboard:write', text),
  /*
   * A dropped file's path. File.path was removed in Electron 32, and webUtils
   * only exists here — the renderer is sandboxed.
   */
  pathForFile: (file) => webUtils.getPathForFile(file),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  openSessionsDir: () => ipcRenderer.send('session:reveal-dir'),
  captureWindow: (path) => ipcRenderer.invoke('debug:capture', path),
  focusWindow: () => ipcRenderer.invoke('debug:focus'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  openSettingsFile: () => ipcRenderer.send('settings:reveal'),
  getKeybindings: () => ipcRenderer.invoke('keybindings:get'),
  saveKeybindings: (bindings) => ipcRenderer.invoke('keybindings:save', bindings),
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    confirmClose: () => ipcRenderer.send('window:confirm-close'),
    onCloseRequested: (handler) => {
      const listener = (): void => handler()
      ipcRenderer.on('app:close-requested', listener)
      return () => ipcRenderer.off('app:close-requested', listener)
    },
    toggleFullScreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
    toggleDevTools: () => ipcRenderer.send('window:toggle-devtools'),
    onMaximizeChange: (handler) => {
      const listener = (_e: unknown, maximized: boolean): void => handler(maximized)
      ipcRenderer.on('window:maximize-changed', listener)
      return () => ipcRenderer.off('window:maximize-changed', listener)
    },
  },
  onData: (handler) => {
    const listener = (_e: unknown, paneId: string, data: string): void => handler(paneId, data)
    ipcRenderer.on('pty:data', listener)
    return () => ipcRenderer.off('pty:data', listener)
  },
  onExit: (handler) => {
    const listener = (_e: unknown, exit: PtyExit): void => handler(exit)
    ipcRenderer.on('pty:exit', listener)
    return () => ipcRenderer.off('pty:exit', listener)
  },
  onAttention: (handler) => {
    const listener = (_e: unknown, attention: PaneAttention): void => handler(attention)
    ipcRenderer.on('pty:attention', listener)
    return () => ipcRenderer.off('pty:attention', listener)
  },
}

contextBridge.exposeInMainWorld('termspace', api)
