/**
 * What a pane's title is worth showing, and how the title bar spells it.
 *
 * `shell` is the title a pane gets when nothing named it, so it carries no
 * information: the strip and the peek labels both treat it as no title at all.
 */

export const DEFAULT_PANE_TITLE = 'shell'

export function isDefaultPaneTitle(title: string): boolean {
  const trimmed = title.trim()
  return trimmed === '' || trimmed === DEFAULT_PANE_TITLE
}

/**
 * What the bar calls a pane, focused or beside it: the title someone chose,
 * else what it is running, else nothing (the view draws a placeholder).
 */
export function neighbourName(title: string, command: string | null): string | null {
  if (!isDefaultPaneTitle(title)) return title.trim()
  const running = command?.trim() ?? ''
  return running === '' ? null : running
}
