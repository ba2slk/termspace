/**
 * Types shared by main and renderer. Imported from both sides, so it references
 * neither electron nor the DOM — declarations only, no runtime code.
 */

import type { Bindings } from './keybindings'
import type { TerminalTheme } from './terminal-themes'

export type { Bindings, TerminalTheme }

export interface ConfigIssue {
  /** Location within the YAML, e.g. columns[0].panes[1].height */
  readonly path: string
  readonly message: string
}

export interface PaneSpec {
  readonly kind: 'pane'
  readonly title: string
  readonly command: string | null
  /** Typed into the shell but not submitted, for commands you want to review first. */
  readonly prefill: string | null
  /** Already resolved to an absolute path. */
  readonly cwd: string
  readonly heightRatio: number
}

export interface ErrorSpec {
  readonly kind: 'error'
  readonly issue: ConfigIssue
  readonly heightRatio: number
}

export type PaneEntry = PaneSpec | ErrorSpec

export interface ColumnSpec {
  readonly width: number
  readonly panes: readonly PaneEntry[]
}

export interface SessionSpec {
  readonly name: string
  readonly cwd: string
  readonly shell: string
  readonly columns: readonly ColumnSpec[]
}

/** App settings. Unlike session files, the app owns and writes these. */
export interface AppSettings {
  /** Default column width in px; a session file's width wins. */
  readonly defaultColumnWidth: number
  readonly fontSize: number
  readonly lineHeight: number
  /** Lines of history kept per pane. */
  readonly scrollback: number
  /** Wheel multiplier per notch. 1 disables acceleration. */
  readonly scrollBoost: number
  /** Sidebar width in px. */
  readonly sidebarWidth: number
  /** 1 keeps the sidebar open. Toggled with Alt+S and remembered. */
  readonly sidebarVisible: number
  /** 1 copies on selection. Overwrites the clipboard, so it can be turned off. */
  readonly copyOnSelect: number
  /** 1 lets Shift+wheel slide the canvas sideways. */
  readonly shiftPanning: number
  /**
   * 1 lets the wheel slide the canvas while over the title bar.
   *
   * A mouse has no horizontal wheel and the seams between panels are too small
   * to aim at, so the bar stands in as a target that is always there.
   */
  readonly barPanning: number
  /**
   * How far to dim unfocused panes, in percent.
   *
   * The whole point is watching several terminals at once, so this is a
   * trade-off only the user can settle. 0 leaves the border as the sole cue.
   */
  readonly idleDim: number
  /**
   * 1 lets a program's own notification (OSC 9 / OSC 777) reach the desktop.
   *
   * Sent unless the pane that rang is the one being watched, which is not the
   * same as the window being focused — panes sit off screen here by design.
   *
   * The bell is never forwarded whatever this says: bash rings it for an
   * ambiguous tab completion, and that is not something to interrupt anyone
   * with. It is shown inside the app instead.
   */
  readonly notifications: number
  /**
   * Terminal font. Empty means the app's default stack.
   *
   * One family only — fallbacks behind it cover glyphs the chosen face lacks.
   */
  readonly fontFamily: string
  /**
   * Palette name. Empty means the default.
   *
   * Bundled palettes and user files share one namespace; unknown names fall back.
   */
  readonly theme: string
  /**
   * Size of the app's own text and title bar, in percent.
   *
   * Separate from fontSize, which is the terminal's: one is how big the tool
   * is, the other how big the work inside it is. Canvas geometry is left
   * alone — column widths are absolute pixels and mean the same at any scale.
   */
  readonly uiScale: number
  /**
   * Interface language: 'en', 'ko', or empty for the system's.
   *
   * Read at startup only. Every screen bakes its strings in when it is built,
   * so switching without a restart would need all of them rebuilt.
   */
  readonly locale: string
}

export interface SessionSummary {
  /** File name without extension. Not necessarily the display name. */
  readonly id: string
  /** Display name: the YAML's name, or the file name. */
  readonly name: string
  /** Absolute path, shown when reporting a config error. */
  readonly file: string
  readonly paneCount: number
  /** Why it can't be opened, or null. */
  readonly error: string | null
}

/**
 * The current layout, handed to main when saving a session.
 *
 * cwd is deliberately absent: only main holds the pty and can see where the
 * shell moved to.
 */
export interface LayoutSnapshot {
  readonly columns: readonly {
    readonly width: number
    readonly panes: readonly {
      /** main resolves the live cwd from this id. */
      readonly paneId: string
      readonly title: string
      readonly command: string | null
      /** Kept as-is on save; a pane with a prefill never has its command captured. */
      readonly prefill: string | null
      /** Used when the pty is already gone: the path this pane started in. */
      readonly fallbackCwd: string
      readonly heightRatio: number
    }[]
  }[]
}

export interface SaveSessionResult {
  readonly ok: boolean
  /** Absolute path written, on success. */
  readonly file: string
  /** Failure reason, or null. */
  readonly error: string | null
}

/**
 * The shell hook reports the line the user submitted, before alias expansion.
 * Installing it means adding `rcLine` to ~/.bashrc by hand — the app never
 * edits that file.
 */
export interface ShellIntegrationStatus {
  readonly rcLine: string
  /** True once a live pane's shell has announced the hook. */
  readonly active: boolean
}

export interface SpawnRequest {
  readonly paneId: string
  readonly cwd: string
  readonly shell: string
  /** Command to send once the shell is ready. */
  readonly command: string | null
  /** Typed without submitting. */
  readonly prefill: string | null
  readonly cols: number
  readonly rows: number
}

export interface SpawnResult {
  readonly ok: boolean
  /** Set only on failure. */
  readonly message: string | null
}

export interface PtyExit {
  readonly paneId: string
  readonly exitCode: number
  readonly signal: number | null
}

/**
 * A pane asking to be looked at: the bell, or a notification the program sent
 * explicitly (OSC 9 / OSC 777).
 *
 * The pane may well be off screen and frozen when this arrives — main watches
 * the pty directly so that a bell does not wait for the pane to be drawn.
 */
export interface PaneAttention {
  readonly paneId: string
  readonly kind: 'bell' | 'notify'
  /** Empty for a bell, and for an OSC 9, which carries a body alone. */
  readonly title: string
  /** Empty for a bell. */
  readonly body: string
}

/**
 * An edit command from the mac application menu.
 *
 * Cmd+C/V match a menu accelerator, and Electron resolves those before the page
 * sees the key — so on mac the menu, not the keymap, is where these arrive.
 */
export type MenuAction = 'copy' | 'paste'

export interface LoadSessionResult {
  readonly ok: boolean
  readonly spec: SessionSpec | null
  /** Absolute path that was read, shown on the error card. */
  readonly file: string
  readonly issues: readonly ConfigIssue[]
}

export interface TermspaceApi {
  /**
   * `process.platform`, as data rather than a call: the renderer has no Node,
   * and the platform cannot change while the window is open. Typed as a string
   * because the renderer's tsconfig carries no Node types.
   */
  readonly platform: string
  listSessions(): Promise<readonly SessionSummary[]>
  loadSession(name: string): Promise<LoadSessionResult>
  /** Create the example session and return its path. */
  createExampleSession(): Promise<string>
  /** Does this id already exist? Drives the overwrite affordance. */
  sessionExists(id: string): Promise<boolean>
  /** Write the layout. Refuses to replace an existing file unless overwrite is set. */
  saveSessionAs(
    id: string,
    displayName: string,
    layout: LayoutSnapshot,
    overwrite: boolean,
    /** `~`-style or absolute; main resolves it. Session root for the file. */
    rootCwd: string,
  ): Promise<SaveSessionResult>
  /** Create a blank one-pane session rooted at rootCwd. Fails rather than overwriting. */
  createBlankSession(id: string, displayName: string, rootCwd: string): Promise<SaveSessionResult>
  /** $HOME, for showing paths in `~` form. */
  userHome(): Promise<string>
  /**
   * Root the save dialog should suggest: the deepest directory the live
   * shells share, `~`-shortened. Only main can see where the shells moved.
   */
  suggestRootCwd(paneIds: readonly string[]): Promise<string>
  /**
   * Native folder chooser, opened at `current`. Returns the pick `~`-shortened,
   * or null if it was cancelled — typing the path still works either way.
   */
  pickDirectory(current: string): Promise<string | null>
  /** The rc line to install, and whether any live pane has the hook loaded. */
  shellIntegrationStatus(): Promise<ShellIntegrationStatus>
  /** Move the session file to the trash, so the delete stays reversible. */
  deleteSession(id: string): Promise<SaveSessionResult>
  /** Full editor invocation for this session's file, or null when it is missing. */
  editorCommandFor(id: string): Promise<string | null>
  /** Open the session file with the OS default app — for when no session is on screen. */
  openSessionFileExternal(id: string): void
  /** Monospace fonts installed on this machine. */
  listMonoFonts(): Promise<readonly string[]>
  /** User palettes from ~/.config/termspace/themes/, added to the bundled ones. */
  listUserThemes(): Promise<readonly TerminalTheme[]>
  /** Open the palettes folder, creating it with an example if needed. */
  openThemesDir(): void
  spawn(request: SpawnRequest): Promise<SpawnResult>
  /**
   * Foreground command per pane, null when idle. A snapshot for the overview;
   * only main holds the ptys and can read /proc.
   */
  foregroundCommands(paneIds: readonly string[]): Promise<Record<string, string | null>>
  write(paneId: string, data: string): void
  resize(paneId: string, cols: number, rows: number): void
  kill(paneId: string): void
  /** Electron's clipboard: navigator.clipboard needs focus and permissions. */
  /** Absolute path of a dropped file. Empty when it has none, as for a drag from a browser. */
  pathForFile(file: File): string
  writeClipboard(text: string): void
  readClipboard(): Promise<string>
  /** The app draws its own title bar, so it owns the window controls too. */
  readonly window: {
    minimize(): void
    toggleMaximize(): Promise<boolean>
    /** Request a close. The renderer decides whether to ask first. */
    close(): void
    /** Confirmed — close for real. */
    confirmClose(): void
    /** A close was attempted, from any path. Returns an unsubscribe function. */
    onCloseRequested(handler: () => void): () => void
    toggleFullScreen(): Promise<boolean>
    toggleDevTools(): void
    onMaximizeChange(handler: (maximized: boolean) => void): () => void
  }
  /** Open the sessions folder in the file manager. */
  openSessionsDir(): void
  /** Screenshot the window. Self-check builds only. */
  captureWindow(path: string): Promise<string>
  /** Raise and focus the window, reporting whether it worked. Self-check only. */
  focusWindow(): Promise<boolean>
  getSettings(): Promise<AppSettings>
  /** Clamps out-of-range values and returns what was actually stored. */
  saveSettings(settings: AppSettings): Promise<AppSettings>
  /** Open the settings file, creating it with defaults if needed. */
  openSettingsFile(): void
  getKeybindings(): Promise<Bindings>
  /** Drops unusable chords and returns what was actually stored. */
  saveKeybindings(bindings: Bindings): Promise<Bindings>
  /** Batched output. Returns an unsubscribe function. */
  onData(handler: (paneId: string, data: string) => void): () => void
  onExit(handler: (exit: PtyExit) => void): () => void
  /**
   * Window titles per pane (OSC 0/2), null when the program never set one.
   * A snapshot for the overview, like foregroundCommands.
   */
  paneTitles(paneIds: readonly string[]): Promise<Record<string, string | null>>
  /** A pane rang or sent a notification. Returns an unsubscribe function. */
  onAttention(handler: (attention: PaneAttention) => void): () => void
  /**
   * A desktop notification was clicked: go to the pane that sent it, whichever
   * session it belongs to. Returns an unsubscribe function.
   */
  onFocusPane(handler: (paneId: string) => void): () => void
  /**
   * Copy or Paste was chosen in the mac application menu — including by its
   * accelerator. Never fires elsewhere: no other platform has the menu.
   * Returns an unsubscribe function.
   */
  onMenuAction(handler: (action: MenuAction) => void): () => void
  /**
   * The one pane the user is actually looking at — focused, in the session on
   * screen. Null when no session is up.
   *
   * Only the renderer knows this, and a notification's whole question is
   * whether the pane that rang was already being watched. Window focus alone
   * cannot answer it: panes live off screen here by design.
   */
  setVisiblePane(paneId: string | null): void
}
