/**
 * What the two menus contain, decided without a DOM.
 *
 * Which command is greyed out, and which label a row carries, are rules about
 * the app's state — not about drawing. Keeping them here lets the rules be
 * read, and tested, on their own; main still supplies what each row does.
 */
import type { ActionId } from '../shared/keybindings'
import type { CommandItem } from './command-menu'
import { t } from './i18n'

/** What the ☰ menu needs to know about the app right now. */
export interface CommandState {
  /** A session is on the canvas, so the pane commands have something to act on. */
  readonly hasSession: boolean
  /**
   * A session is named, whether or not its runtime is up.
   *
   * "Edit session file" needs the file, not the panes, so it asks this rather
   * than hasSession.
   */
  readonly hasSessionId: boolean
  readonly sidebarVisible: boolean
  /** The chord to print beside a row; empty when the action is unbound. */
  readonly hint: (id: ActionId) => string
}

/** One callback per row, wired by main. */
export interface CommandActions {
  readonly closePane: () => void
  readonly newSession: () => void
  readonly saveLayout: () => void
  readonly saveLayoutAs: () => void
  readonly editSessionFile: () => void
  readonly toggleSidebar: () => void
  readonly settings: () => void
  readonly openSessionsDir: () => void
  readonly fullscreen: () => void
  readonly devTools: () => void
  readonly quit: () => void
}

/**
 * The ☰ menu. Splitting has its own control, leaving occasional app-level
 * commands here.
 */
export function commandItems(
  state: CommandState,
  actions: CommandActions,
): readonly CommandItem[] {
  // Grouped by what they act on: the pane, this session's file, the session
  // list, the view, the app. Quit stands alone.
  return [
    {
      label: t.firstRun.closePane,
      hint: state.hint('close-pane'),
      disabled: !state.hasSession,
      run: actions.closePane,
    },
    {
      label: t.firstRun.saveLayout,
      hint: state.hint('save-layout'),
      disabled: !state.hasSession,
      separatorBefore: true,
      run: actions.saveLayout,
    },
    {
      label: t.firstRun.saveLayoutAs,
      disabled: !state.hasSession,
      run: actions.saveLayoutAs,
    },
    {
      label: t.firstRun.editSessionFile,
      disabled: !state.hasSessionId,
      run: actions.editSessionFile,
    },
    { label: t.firstRun.newSession, separatorBefore: true, run: actions.newSession },
    { label: t.firstRun.openSessionsDir, run: actions.openSessionsDir },
    {
      label: state.sidebarVisible ? t.firstRun.hideSessionList : t.firstRun.showSessionList,
      hint: state.hint('toggle-sidebar'),
      separatorBefore: true,
      run: actions.toggleSidebar,
    },
    {
      label: t.firstRun.fullscreen,
      hint: state.hint('fullscreen'),
      run: actions.fullscreen,
    },
    {
      label: t.firstRun.settings,
      hint: state.hint('settings'),
      separatorBefore: true,
      run: actions.settings,
    },
    { label: t.firstRun.devTools, run: actions.devTools },
    { label: t.firstRun.quit, separatorBefore: true, run: actions.quit },
  ]
}

/** What the sidebar's right-click menu needs to know about the row under it. */
export interface SidebarMenuState {
  /** Null over empty space: the list's own commands, not a session's. */
  readonly sessionId: string | null
  /** That session has a live runtime. */
  readonly running: boolean
  /** That session is the one on the canvas. */
  readonly isCurrent: boolean
  /** It sits in the archive dock, not in the list. */
  readonly archived: boolean
}

export interface SidebarMenuActions {
  readonly open: () => void
  readonly endSession: () => void
  readonly saveLayout: () => void
  readonly editSessionFile: () => void
  readonly renameSession: () => void
  readonly newSession: () => void
  readonly refreshList: () => void
  readonly openSessionsDir: () => void
  readonly deleteSession: () => void
  readonly archiveSession: () => void
  readonly restoreSession: () => void
}

/**
 * Sidebar context menu: session commands over a row, list commands over empty
 * space.
 */
export function sidebarMenuItems(
  state: SidebarMenuState,
  actions: SidebarMenuActions,
): readonly CommandItem[] {
  if (state.sessionId === null) {
    return [
      { label: t.firstRun.newSession, run: actions.newSession },
      { label: t.firstRun.refreshList, separatorBefore: true, run: actions.refreshList },
      { label: t.firstRun.openSessionsDir, run: actions.openSessionsDir },
    ]
  }

  /*
   * An archived row is a shelf, not a session: opening, renaming and saving a
   * layout into it all assume a place in the list it no longer has. What is
   * left is getting it back, or letting it go.
   */
  if (state.archived) {
    return [
      { label: t.firstRun.restoreSession, run: actions.restoreSession },
      {
        label: t.firstRun.deleteSession,
        separatorBefore: true,
        danger: true,
        run: actions.deleteSession,
      },
    ]
  }

  /* Being told "open" about the session you are looking at reads as a lie. */
  const viewing = state.running && state.isCurrent
  return [
    {
      label: viewing ? t.firstRun.viewing : t.firstRun.open,
      disabled: viewing,
      run: actions.open,
    },
    {
      label: t.firstRun.endSession,
      disabled: !state.running,
      run: actions.endSession,
    },
    /*
     * Only over the row that is actually on screen. Anywhere else it would read
     * as "write my layout into that session", which is a different command and
     * one nobody asked for. Shown disabled rather than hidden, so the rule —
     * this belongs to the session you are looking at — is visible.
     */
    // This session's file: its name first, then what goes into it.
    { label: t.firstRun.renameSession, separatorBefore: true, run: actions.renameSession },
    {
      label: t.firstRun.saveLayout,
      disabled: !state.isCurrent,
      run: actions.saveLayout,
    },
    { label: t.firstRun.editSessionFile, run: actions.editSessionFile },
    // List commands (new session, the folder) belong to the empty-space menu:
    // this one is about the row under the pointer.
    // Leaving the list: reversibly first, then not.
    { label: t.firstRun.archiveSession, separatorBefore: true, run: actions.archiveSession },
    {
      label: t.firstRun.deleteSession,
      danger: true,
      run: actions.deleteSession,
    },
  ]
}
