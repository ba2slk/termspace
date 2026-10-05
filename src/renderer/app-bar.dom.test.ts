import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppBarHooks } from './app-bar'

/*
 * The bar reads the platform and the window bridge as it is built, so the stub
 * has to be on window before the import.
 */
vi.stubGlobal('termspace', {
  platform: 'linux',
  window: {
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    onMaximizeChange: () => () => {},
  },
  update: { openRelease: vi.fn() },
})

const { createAppBar } = await import('./app-bar')

const hooks = (): AppBarHooks => ({
  items: () => [],
  onToggleSidebar: vi.fn(),
  sidebarVisible: () => true,
  onSplit: vi.fn(),
  onAddColumn: vi.fn(),
  canSplit: () => true,
  hasSession: () => true,
  onSave: vi.fn(),
  onPan: vi.fn(),
  barPans: () => true,
  onFocusPane: vi.fn(),
  hint: () => '',
})

beforeEach(() => {
  document.body.replaceChildren()
})

describe('app bar left side', () => {
  const left = (): HTMLElement => document.querySelector<HTMLElement>('.app-bar__side')!
  /** Each child by what it is, so a reorder reads as a reorder. */
  const order = (): string[] =>
    [...left().children].map((el) => {
      if (el.classList.contains('app-bar__divider')) return 'divider'
      if (el.classList.contains('update-chip')) return 'update-chip'
      const action = (el as HTMLElement).dataset['action']
      if (action !== undefined) return action
      return el.querySelector('.app-bar__btn-label') !== null ? 'sidebar-toggle' : 'menu'
    })

  it('puts the menu apart, then split, save and the sidebar toggle', () => {
    createAppBar(document.body, hooks())
    expect(order()).toEqual(['menu', 'divider', 'split-menu', 'save-layout', 'sidebar-toggle', 'update-chip'])
  })

  it('keeps the update chip after the toggle while the toggle carries the session name', () => {
    const bar = createAppBar(document.body, hooks())
    bar.setSidebarVisible(false)
    bar.setSession('work')
    const toggle = left().querySelector('.app-bar__btn--labelled')!
    expect(toggle.textContent).toBe('work')
    expect(toggle.nextElementSibling?.classList.contains('update-chip')).toBe(true)
  })
})
