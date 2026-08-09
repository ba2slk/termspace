/**
 * Paths as a shell will read them. Pure.
 *
 * Dropped file names come from the filesystem and land on a command line, so
 * they have to arrive as one word whatever they contain.
 */

/**
 * Single quotes take everything literally, so only the quote itself needs
 * handling: close, escape one, reopen.
 */
export function shellQuote(path: string): string {
  if (/^[\w@%+=:,./-]+$/.test(path)) return path
  return `'${path.replaceAll("'", `'\\''`)}'`
}
