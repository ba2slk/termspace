/**
 * Whether a click on a link means "open it".
 *
 * A plain click in a terminal starts a selection, so opening needs a modifier —
 * Ctrl off mac, Cmd on it. Ctrl+click on mac is the context menu and must not
 * open anything, which is why the platform is asked for rather than accepting
 * either modifier.
 */
export interface LinkClick {
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  /** 0 is the primary button; a middle or right click never activates. */
  readonly button: number
}

export function isLinkActivation(event: LinkClick, isMac: boolean): boolean {
  if (event.button !== 0) return false
  return isMac ? event.metaKey : event.ctrlKey
}
