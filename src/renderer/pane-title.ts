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
 * The title bar strip: the session, plus the focused pane when it has a title.
 *
 * The separator belongs to the locale, so the composition arrives as the
 * catalog's own function rather than being spelled here.
 */
export function barTitle(
  session: string,
  paneTitle: string | null,
  compose: (session: string, pane: string) => string,
): string {
  if (paneTitle === null || isDefaultPaneTitle(paneTitle)) return session
  return compose(session, paneTitle.trim())
}
