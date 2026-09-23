/**
 * The key the default terminal is filed under among the open sessions.
 *
 * It has no file, so it needs a key no file can have: session ids may not start
 * with a dot, and `toSessionId` strips one from anything typed.
 */
export const DEFAULT_TERMINAL_ID = '.terminal'

export function isDefaultTerminal(id: string | null): boolean {
  return id === DEFAULT_TERMINAL_ID
}
