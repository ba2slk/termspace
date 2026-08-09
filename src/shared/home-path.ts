/**
 * ~-shortening for paths under home, shared by both sides of the bridge.
 *
 * Main writes it into session files so they travel with dotfiles; the renderer
 * shows the same form in the save dialog. One implementation, or the path on
 * screen and the path in the file drift apart. Pure.
 */
export function shorten(path: string, home: string): string {
  if (home === '') return path
  if (path === home) return '~'
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}
