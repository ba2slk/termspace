import { describe, expect, it, vi } from 'vitest'
import type { ActionId } from '../shared/keybindings'
import { t } from './i18n'
import {
  commandItems,
  sidebarMenuItems,
  type CommandActions,
  type CommandState,
  type SidebarMenuActions,
  type SidebarMenuState,
} from './menu-model'

/** Every row's callback, so a test can say which one a click reached. */
function spyActions<T extends string>(names: readonly T[]): Record<T, () => void> {
  const actions = {} as Record<T, () => void>
  for (const name of names) actions[name] = vi.fn()
  return actions
}

const COMMAND_ACTIONS: readonly (keyof CommandActions)[] = [
  'closePane', 'newSession', 'saveLayout', 'saveLayoutAs', 'editSessionFile',
  'toggleSidebar', 'settings', 'openSessionsDir', 'fullscreen', 'devTools', 'quit',
]

const SIDEBAR_ACTIONS: readonly (keyof SidebarMenuActions)[] = [
  'open', 'endSession', 'saveLayout', 'editSessionFile', 'renameSession',
  'newSession', 'refreshList', 'openSessionsDir', 'deleteSession',
]

/** Stands in for a keymap: every action is bound to its own name. */
const hint = (id: ActionId): string => `chord:${id}`

function command(state: Partial<CommandState> = {}): {
  readonly items: ReturnType<typeof commandItems>
  readonly actions: CommandActions
} {
  const actions = spyActions(COMMAND_ACTIONS)
  const items = commandItems(
    { hasSession: true, hasSessionId: true, sidebarVisible: false, hint, ...state },
    actions,
  )
  return { items, actions }
}

const labels = (items: readonly { readonly label: string }[]): string[] =>
  items.map((item) => item.label)

const disabled = (
  items: readonly { readonly label: string; readonly disabled?: boolean }[],
): string[] => items.filter((item) => item.disabled === true).map((item) => item.label)

const groups = (
  items: readonly { readonly label: string; readonly separatorBefore?: boolean }[],
): string[][] => {
  const out: string[][] = []
  for (const item of items) {
    if (item.separatorBefore === true || out.length === 0) out.push([])
    out[out.length - 1]!.push(item.label)
  }
  return out
}

describe('the ☰ menu', () => {
  it('is grouped by what each command acts on', () => {
    expect(groups(command({ sidebarVisible: true }).items)).toEqual([
      [t.firstRun.closePane],
      [t.firstRun.saveLayout, t.firstRun.saveLayoutAs, t.firstRun.editSessionFile],
      [t.firstRun.newSession, t.firstRun.openSessionsDir],
      [t.firstRun.hideSessionList, t.firstRun.fullscreen],
      [t.firstRun.settings, t.firstRun.devTools],
      [t.firstRun.quit],
    ])
  })

  it('greys out the pane and layout commands with nothing on the canvas', () => {
    expect(disabled(command({ hasSession: false, hasSessionId: false }).items)).toEqual([
      t.firstRun.closePane,
      t.firstRun.saveLayout,
      t.firstRun.saveLayoutAs,
      t.firstRun.editSessionFile,
    ])
  })

  it('leaves every command live once a session is up', () => {
    expect(disabled(command().items)).toEqual([])
  })

  /*
   * A session can be named without a runtime — the file is still there to open
   * in an editor, so that one row does not follow the others.
   */
  it('keeps the file editable when only the id is known', () => {
    const items = command({ hasSession: false, hasSessionId: true }).items
    expect(disabled(items)).not.toContain(t.firstRun.editSessionFile)
    expect(disabled(items)).toContain(t.firstRun.closePane)
  })

  it('names the sidebar row after what the click will do', () => {
    expect(labels(command({ sidebarVisible: false }).items)).toContain(t.firstRun.showSessionList)
    expect(labels(command({ sidebarVisible: true }).items)).toContain(t.firstRun.hideSessionList)
  })

  it('prints the chord only where there is a shortcut', () => {
    const items = command().items
    const hintOf = (label: string): string | undefined =>
      items.find((item) => item.label === label)?.hint
    expect(hintOf(t.firstRun.closePane)).toBe('chord:close-pane')
    expect(hintOf(t.firstRun.settings)).toBe('chord:settings')
    expect(hintOf(t.firstRun.devTools)).toBeUndefined()
  })

  it('drops the hint for an unbound action', () => {
    const items = commandItems(
      { hasSession: true, hasSessionId: true, sidebarVisible: false, hint: () => '' },
      spyActions(COMMAND_ACTIONS),
    )
    expect(items.find((item) => item.label === t.firstRun.settings)?.hint).toBe('')
  })

  it('runs the command the row was built for', () => {
    const { items, actions } = command()
    items.find((item) => item.label === t.firstRun.quit)?.run()
    expect(actions.quit).toHaveBeenCalledTimes(1)
    expect(actions.devTools).not.toHaveBeenCalled()
  })
})

function sidebar(state: Partial<SidebarMenuState> = {}): {
  readonly items: ReturnType<typeof sidebarMenuItems>
  readonly actions: SidebarMenuActions
} {
  const actions = spyActions(SIDEBAR_ACTIONS)
  const items = sidebarMenuItems(
    { sessionId: 'work', running: true, isCurrent: true, ...state },
    actions,
  )
  return { items, actions }
}

describe('the sidebar menu', () => {
  it('is grouped: run the session, its file, the list, then delete', () => {
    expect(groups(sidebar({}).items)).toEqual([
      [t.firstRun.viewing, t.firstRun.endSession],
      [t.firstRun.renameSession, t.firstRun.saveLayout, t.firstRun.editSessionFile],
      [t.firstRun.newSession, t.firstRun.openSessionsDir],
      [t.firstRun.deleteSession],
    ])
  })

  it('offers the list commands over empty space', () => {
    expect(labels(sidebar({ sessionId: null }).items)).toEqual([
      t.firstRun.newSession,
      t.firstRun.refreshList,
      t.firstRun.openSessionsDir,
    ])
  })

  /* Being told "open" about the session on screen would read as a lie. */
  it('says "viewing", inertly, over the session on the canvas', () => {
    const items = sidebar({ running: true, isCurrent: true }).items
    expect(items[0]?.label).toBe(t.firstRun.viewing)
    expect(items[0]?.disabled).toBe(true)
  })

  it('offers to open a session that is running but not on screen', () => {
    const items = sidebar({ running: true, isCurrent: false }).items
    expect(items[0]?.label).toBe(t.firstRun.open)
    expect(items[0]?.disabled).toBe(false)
  })

  it('offers to open a session that is not running at all', () => {
    const items = sidebar({ running: false, isCurrent: false }).items
    expect(items[0]?.label).toBe(t.firstRun.open)
    expect(items[0]?.disabled).toBe(false)
  })

  it('greys out ending a session that has no runtime', () => {
    expect(disabled(sidebar({ running: false, isCurrent: false }).items)).toContain(
      t.firstRun.endSession,
    )
    expect(disabled(sidebar({ running: true, isCurrent: false }).items)).not.toContain(
      t.firstRun.endSession,
    )
  })

  /* "Save this layout" writes what is on screen, so only that row may offer it. */
  it('offers the layout save on the current row alone', () => {
    expect(disabled(sidebar({ isCurrent: false }).items)).toContain(t.firstRun.saveLayout)
    expect(disabled(sidebar({ isCurrent: true }).items)).not.toContain(t.firstRun.saveLayout)
  })

  it('marks only the delete as dangerous', () => {
    const danger = sidebar().items.filter((item) => item.danger === true)
    expect(labels(danger)).toEqual([t.firstRun.deleteSession])
  })

  it('runs the command the row was built for', () => {
    const { items, actions } = sidebar({ running: true, isCurrent: false })
    items.find((item) => item.label === t.firstRun.renameSession)?.run()
    expect(actions.renameSession).toHaveBeenCalledTimes(1)
    expect(actions.deleteSession).not.toHaveBeenCalled()
  })
})
