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

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** Leading words of a command line; a quoted word stays whole, quotes removed. */
function words(command: string): string[] {
  const out: string[] = []
  let rest = command.trim()
  while (rest !== '') {
    const quote = rest[0]
    if (quote === '"' || quote === "'") {
      const end = rest.indexOf(quote, 1)
      out.push(end === -1 ? rest.slice(1) : rest.slice(1, end))
      rest = end === -1 ? '' : rest.slice(end + 1).trimStart()
    } else {
      const end = rest.search(/\s/)
      out.push(end === -1 ? rest : rest.slice(0, end))
      rest = end === -1 ? '' : rest.slice(end).trimStart()
    }
  }
  return out
}

/** The program a command line runs, without its folder or arguments. */
export function programName(command: string): string | null {
  const first = words(command).find((word) => !ENV_ASSIGNMENT.test(word))
  if (first === undefined) return null
  const name = first.slice(first.lastIndexOf('/') + 1).trim()
  return name === '' ? null : name
}

/** A folder as the strip shows it: its own name and a slash, `~` for home, `/` for the root. */
export function folderName(cwd: string, home: string): string | null {
  let path = cwd.trim()
  if (path === '') return null
  if (path === '~' || path.startsWith('~/')) {
    if (home === '') {
      path = path.replace(/^~\/*/, '')
      if (path.replace(/\/+$/, '') === '') return '~'
    } else {
      path = home + path.slice(1)
    }
  }
  const bare = path.replace(/\/+$/, '')
  if (bare === '') return '/'
  if (home !== '' && bare === home.replace(/\/+$/, '')) return '~'
  return `${bare.slice(bare.lastIndexOf('/') + 1)}/`
}

/**
 * What the bar calls a pane, focused or beside it: the title someone chose,
 * else the program in the foreground, else the idle shell's folder, else
 * nothing (the view draws a placeholder). Short on purpose: a whole command
 * line crowds the strip, and the placeholder for an idle shell said nothing.
 */
export function stripName(
  title: string,
  command: string | null,
  cwd: string | null,
  home: string,
): string | null {
  if (!isDefaultPaneTitle(title)) return title.trim()
  const program = command === null ? null : programName(command)
  if (program !== null) return program
  return cwd === null ? null : folderName(cwd, home)
}
