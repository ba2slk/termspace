/**
 * Where everything the app reads or writes lives: sessions, themes, settings,
 * keybindings, the shell hooks.
 *
 * XDG on every platform, mac included — Application Support would split a
 * user's files across machines that otherwise share a dotfile repo, and the
 * paths are already documented as ~/.config/termspace.
 */
import { join } from 'node:path'

export function configDir(env: NodeJS.ProcessEnv): string {
  const base = env['XDG_CONFIG_HOME'] ?? join(env['HOME'] ?? '', '.config')
  return join(base, 'termspace')
}
