/**
 * Turn the on-screen layout into session YAML.
 *
 * Widths and height ratios are the part nobody wants to write by hand. This
 * module only produces text; whether to overwrite is the caller's decision.
 * Pure — no filesystem, no Electron.
 */
import { stringify } from 'yaml'
import { shorten } from '../shared/home-path'

export interface DraftPane {
  readonly title: string
  /** Command to type once the shell is up. */
  readonly command: string | null
  /** Typed but not submitted; wins over capture when saving. */
  readonly prefill: string | null
  /** Absolute path — where the shell actually stands, for a live pane. */
  readonly cwd: string
  readonly heightRatio: number
}

export interface DraftColumn {
  readonly width: number
  readonly panes: readonly DraftPane[]
}

export interface SessionDraft {
  readonly name: string
  /** Absolute root; pane cwds inside it are written relative to it. */
  readonly cwd: string
  readonly columns: readonly DraftColumn[]
}

/**
 * Usable as a file name?
 *
 * The value comes from the renderer and is concatenated into a path, so this
 * is an allowlist rather than a denylist.
 */
export function isValidSessionId(id: string): boolean {
  if (id.length === 0 || id.length > 64) return false
  if (id.startsWith('.') || id.startsWith('-')) return false
  return /^[\p{L}\p{N}._-]+$/u.test(id)
}

/**
 * A display name as a file name. Mirrors the save dialog's own derivation, so
 * a session renamed in place lands where saving it under that name would.
 * Empty when nothing survives the allowlist — the caller decides what then.
 */
export function deriveSessionId(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}._-]/gu, '')
    .replace(/^[.-]+/, '')
    .slice(0, 64)
}

export { shorten }

/**
 * The deepest directory containing every given path.
 *
 * Suggests a session root from where the live shells actually stand, for
 * sessions whose file never named one. Whole segments only — /a/proj and
 * /a/proj-old meet at /a, not /a/proj.
 */
export function deepestCommonAncestor(paths: readonly string[]): string | null {
  if (paths.length === 0) return null
  const split = paths.map((p) => p.split('/').filter((s) => s !== ''))
  const first = split[0]!
  let depth = first.length
  for (const parts of split.slice(1)) {
    let i = 0
    while (i < depth && i < parts.length && parts[i] === first[i]) i++
    depth = i
  }
  return `/${first.slice(0, depth).join('/')}`
}

/** Three decimals — 0.3333333333333333 in a file is unreadable. */
const round3 = (value: number): number => Math.round(value * 1000) / 1000

/*
 * One field per line, same shape as settings.yaml. The saved file is where
 * most people first meet the format, so it has to teach it.
 */
export const SESSION_HEADER = `# Termspace session
#
# A snapshot of the on-screen layout. Edit it freely; the app only reads it.
#
# name      shown in the session list
# cwd       base directory for every pane. A pane can override it
# columns   left to right. Ones past the window edge are still there (Alt+arrows)
# width     column width in px. Narrowing the window never shrinks it
# panes     top to bottom, inside one column
# title     pane label, shown above the terminal
# command   run once the shell is up
# prefill   typed into the shell, but Enter is left to you
# height    vertical share within the column. Omit for an even split
`

export function toSessionYaml(draft: SessionDraft, home: string): string {
  const root = draft.cwd
  // Inside the root a relative path reads best; outside it, `~` travels well.
  const paneCwd = (cwd: string): string | null => {
    if (cwd === root) return null // matches the root, so the exceptions stand out
    if (cwd.startsWith(`${root}/`)) return cwd.slice(root.length + 1)
    return shorten(cwd, home)
  }

  const body = {
    name: draft.name,
    cwd: shorten(root, home),
    columns: draft.columns.map((column) => ({
      width: Math.round(column.width),
      panes: column.panes.map((pane) => {
        const cwd = paneCwd(pane.cwd)
        return {
          title: pane.title,
          ...(cwd === null ? {} : { cwd }),
          ...(pane.command === null || pane.command === '' ? {} : { command: pane.command }),
          ...(pane.prefill === null || pane.prefill === '' ? {} : { prefill: pane.prefill }),
          // A lone pane in a column is always 1.
          ...(column.panes.length === 1 ? {} : { height: round3(pane.heightRatio) }),
        }
      }),
    })),
  }

  // Let the YAML writer decide quoting — paths and commands need it.
  return `${SESSION_HEADER}\n${stringify(body, { lineWidth: 0 })}`
}
