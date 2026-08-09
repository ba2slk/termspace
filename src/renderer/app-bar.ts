/**
 * The app's own title bar.
 *
 * Replaces the OS menu bar's row with the command menu, window title and window
 * buttons, returning that vertical space to the canvas and giving splitting a
 * visible home alongside the shortcut.
 */
import { api } from './api'
import { createAppMark, MARK_CHROME } from './app-mark'
import { t } from './i18n'
import { createCommandMenu, type CommandItem } from './command-menu'
import type { ActionId } from '../shared/keybindings'

export interface AppBarHooks {
  /** Commands for ☰; asked each time since they depend on session state. */
  readonly items: () => readonly CommandItem[]
  readonly onToggleSidebar: () => void
  readonly sidebarVisible: () => boolean
  /** Split within the column. */
  readonly onSplit: (side: 'up' | 'down') => void
  /** Add a column to either side. */
  readonly onAddColumn: (side: 'left' | 'right') => void
  /** False with no session, or when the minimum height blocks it. */
  readonly canSplit: () => boolean
  readonly hasSession: () => boolean
  /** Write the arrangement over the open session's own file. */
  readonly onSave: () => void
  /**
   * Slide the canvas sideways. The bar is the one strip that is always there
   * and always wide, which a mouse can actually aim at — unlike the 6px seams.
   */
  readonly onPan: (delta: number, deltaMode: number) => void
  /** Whether panning from the bar is enabled at all. */
  readonly barPans: () => boolean
  /** The chord for an action, as the user has it bound right now. */
  readonly hint: (id: ActionId) => string
}

export interface AppBar {
  readonly element: HTMLElement
  setTitle(title: string): void
  setSidebarVisible(visible: boolean): void
  /** Re-evaluate whether the split controls are enabled. */
  syncControls(): void
  /** Collapse any open dropdown before another surface comes forward. */
  closeMenus(): void
  destroy(): void
}

function icon(paths: readonly string[], size = 16): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', `0 0 ${String(size)} ${String(size)}`)
  svg.setAttribute('aria-hidden', 'true')
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '1.2')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('fill', 'none')
    svg.append(path)
  }
  return svg
}

function barButton(className: string, label: string, glyph: SVGElement): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.title = label
  button.setAttribute('aria-label', label)
  button.append(glyph)
  return button
}

export function createAppBar(host: HTMLElement, hooks: AppBarHooks): AppBar {
  const bar = document.createElement('header')
  bar.className = 'app-bar'

  const left = document.createElement('div')
  left.className = 'app-bar__side'

  /*
   * Larger than the 16px icons beside it. Those are line drawings that run the
   * full width of their box; the mark's weight is one circle in the middle, so
   * at a matching size it reads as the smallest thing in the bar.
   */
  const menuButton = barButton('app-bar__btn', t.appBar.menu, createAppMark(MARK_CHROME, 20))
  const menu = createCommandMenu()

  // The menu closes on outside mousedown, so stop this one to keep the toggle.
  menuButton.addEventListener('mousedown', (event) => event.stopPropagation())
  menuButton.addEventListener('click', () => {
    if (menu.isOpen) {
      menu.close()
      return
    }
    menu.open(menuButton, hooks.items())
  })
  // Also in the menu, but frequent enough to deserve one click.
  const panelButton = barButton(
    'app-bar__btn',
    t.appBar.toggleSessionList(hooks.hint('toggle-sidebar')),
    icon(['M2.5 3.5h11v9h-11z', 'M6.5 3.5v9']),
  )
  panelButton.addEventListener('click', () => hooks.onToggleSidebar())

  /*
   * Split control. One button for all four directions.
   *
   * A default-action button for "split down" sat beside this and was dropped:
   * it duplicated an entry of the menu it stood next to, and its glyph — a box
   * with one line through it — was a coin flip against the sidebar toggle's at
   * 16px. The chord still splits in one keystroke, which is the fast path
   * anyway. The crossed box says "four ways", matching what the menu lists.
   */
  const splitButton = barButton(
    'app-bar__btn',
    t.appBar.splitDirection,
    icon(['M3 3.5h10v9H3z', 'M8 3.5v9', 'M3 8h10']),
  )
  splitButton.dataset['action'] = 'split-menu'
  const splitMenu = createCommandMenu()
  splitButton.addEventListener('mousedown', (event) => event.stopPropagation())
  splitButton.addEventListener('click', () => {
    if (splitMenu.isOpen) {
      splitMenu.close()
      return
    }
    const canSplit = hooks.canSplit()
    const hasSession = hooks.hasSession()
    splitMenu.open(splitButton, [
      {
        label: t.appBar.splitUpItem,
        hint: hooks.hint('split-up'),
        disabled: !canSplit,
        run: () => hooks.onSplit('up'),
      },
      {
        label: t.appBar.splitDownItem,
        hint: hooks.hint('split-down'),
        disabled: !canSplit,
        run: () => hooks.onSplit('down'),
      },
      {
        label: t.appBar.addColumnLeft,
        hint: hooks.hint('add-column-left'),
        separatorBefore: true,
        disabled: !hasSession,
        run: () => hooks.onAddColumn('left'),
      },
      {
        label: t.appBar.addColumnRight,
        hint: hooks.hint('add-column-right'),
        disabled: !hasSession,
        run: () => hooks.onAddColumn('right'),
      },
    ])
  })

  /*
   * Saving the arrangement back to the session file.
   *
   * A layout is made by dragging, and what you dragged is gone the moment the
   * session ends — so the one control that keeps it deserves a place that does
   * not start with opening a menu.
   *
   * The floppy disk, anachronism and all. An arrow into a tray was tried first,
   * on the reasoning that the layout is being put away rather than written to a
   * device nobody has owned in twenty years — but that shape means *download*
   * everywhere else on a screen, and a glyph everyone already reads correctly
   * beats one that argues for a better metaphor.
   */
  const saveButton = barButton(
    'app-bar__btn',
    t.appBar.save(hooks.hint('save-layout')),
    icon([
      // Body with the corner cut off, write-protect shutter, label.
      'M3.5 3.5h7.2l1.8 1.8v7.2h-9z',
      'M6 3.5v2.6h3.4V3.5',
      'M5.5 12.5V9.4h5v3.1',
    ]),
  )
  // The self-check finds it by this; its title carries a chord that can change.
  saveButton.dataset['action'] = 'save-layout'
  saveButton.addEventListener('click', () => hooks.onSave())

  const divider = document.createElement('span')
  divider.className = 'app-bar__divider'

  // Splitting and saving both act on the arrangement, so they share a group.
  left.append(menuButton, panelButton, divider, splitButton, saveButton)

  const title = document.createElement('div')
  title.className = 'app-bar__title'

  /*
   * The strip that slides the canvas.
   *
   * It cannot be the whole bar: a -webkit-app-region: drag surface is hit
   * tested by the window manager as the title bar, so the page never sees a
   * wheel or a hover there. Only the no-drag islands did, which made the live
   * area feel like scattered patches. This is one explicit no-drag block around
   * the title, wide enough to aim at, with the bar either side still dragging
   * the window.
   *
   * Nothing is drawn under it — a line there would push the panes away from the
   * bar. Hovering brightens the canvas scrollbar instead, which is what ties
   * the control to the thing it moves.
   */
  const pan = document.createElement('div')
  pan.className = 'app-bar__pan'
  pan.textContent = t.appBar.brand
  pan.addEventListener('dblclick', () => void api.window.toggleMaximize())
  title.append(pan)

  pan.addEventListener(
    'wheel',
    (event) => {
      if (!hooks.barPans()) return
      const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (raw === 0) return
      event.preventDefault()
      hooks.onPan(raw, event.deltaMode)
    },
    { passive: false },
  )

  pan.addEventListener('pointerenter', () => {
    if (hooks.barPans()) bar.classList.add('app-bar--pannable')
  })
  pan.addEventListener('pointerleave', () => bar.classList.remove('app-bar--pannable'))

  const right = document.createElement('div')
  right.className = 'app-bar__side app-bar__side--end'

  const minimize = barButton('app-bar__win', t.appBar.minimize, icon(['M3 8h10']))
  minimize.addEventListener('click', () => api.window.minimize())

  const maximize = barButton('app-bar__win', t.appBar.maximize, icon(['M4 4h8v8H4z']))
  maximize.addEventListener('click', () => void api.window.toggleMaximize())

  const close = barButton('app-bar__win app-bar__win--close', t.appBar.close, icon(['M4 4l8 8M12 4l-8 8']))
  close.addEventListener('click', () => api.window.close())

  right.append(minimize, maximize, close)
  bar.append(left, title, right)
  host.append(bar)

  const offMaximize = api.window.onMaximizeChange((maximized) => {
    maximize.title = maximized ? t.appBar.restore : t.appBar.maximize
    maximize.setAttribute('aria-label', maximize.title)
  })

  return {
    element: bar,
    setTitle(value) {
      pan.textContent = value
    },
    setSidebarVisible(value) {
      panelButton.classList.toggle('app-bar__btn--on', value)
      panelButton.setAttribute('aria-pressed', String(value))
    },
    syncControls() {
      // Enabled while a session is open: adding a column works where splitting
      // a column further does not.
      splitButton.disabled = !hooks.hasSession()
      saveButton.disabled = !hooks.hasSession()
      // Tooltips name a chord, which the settings screen can change under us.
      panelButton.title = t.appBar.toggleSessionList(hooks.hint('toggle-sidebar'))
      saveButton.title = t.appBar.save(hooks.hint('save-layout'))
      // Off, the strip goes back to being window-drag surface like the rest.
      const pans = hooks.barPans()
      pan.classList.toggle('app-bar__pan--off', !pans)
      if (!pans) bar.classList.remove('app-bar--pannable')
    },
    closeMenus() {
      menu.close()
      splitMenu.close()
    },
    destroy() {
      offMaximize()
      menu.destroy()
      splitMenu.destroy()
      bar.remove()
    },
  }
}
