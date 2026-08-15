/**
 * What a save writes: the layout on screen, plus what each pane was started
 * with.
 *
 * The live pane keeps only its title and its share of the column; the command
 * and the prefill came from the file and are carried through untouched, so
 * saving a session and reading it back gives the same session.
 */
import type { LayoutSnapshot, PaneSpec } from '../shared/protocol'
import type { Layout } from './layout-model'

/**
 * @param specs what each pane was started with, by pane id. A pane split at
 *   runtime has no entry — it was never in a file.
 * @param sessionCwd the session's own root, used for a pane that has no path
 *   of its own.
 */
export function layoutSnapshot(
  layout: Layout,
  specs: ReadonlyMap<string, PaneSpec>,
  sessionCwd: string,
): LayoutSnapshot {
  // The live cwd is left to main: only it holds the pty and sees where the
  // shell moved.
  return {
    columns: layout.columns.map((column) => ({
      width: column.width,
      panes: column.panes.map((pane) => {
        const spec = specs.get(pane.id)
        return {
          paneId: pane.id,
          title: pane.title,
          command: spec?.command ?? null,
          prefill: spec?.prefill ?? null,
          fallbackCwd: spec?.cwd ?? sessionCwd,
          heightRatio: pane.heightRatio,
        }
      }),
    })),
  }
}
