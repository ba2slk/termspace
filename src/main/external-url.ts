/**
 * Which URLs are allowed to leave the app.
 *
 * These URLs come out of program output, so the rule has to be a short
 * allowlist rather than a blocklist: file:// and custom schemes can launch
 * anything the desktop has registered for them.
 */
const OPENABLE_SCHEMES: readonly string[] = ['http:', 'https:', 'mailto:']

/** True when the OS may be handed this URL. Never throws — bad input is just false. */
export function isOpenableUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false
  try {
    return OPENABLE_SCHEMES.includes(new URL(url).protocol)
  } catch {
    return false
  }
}
