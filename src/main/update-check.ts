/**
 * Which published release, if any, to offer the running build. Pure.
 *
 * The GitHub payload is untrusted input: every field is checked before it is
 * read, and anything that does not fit is skipped rather than thrown on.
 */

export interface SemVer {
  readonly major: number
  readonly minor: number
  readonly patch: number
  /** Dot-separated identifiers after the hyphen; numeric ones as numbers. */
  readonly prerelease: readonly (string | number)[]
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseSemver(input: string): SemVer | null {
  const m = SEMVER.exec(input)
  if (m === null) return null
  const prerelease = (m[4] ?? '')
    .split('.')
    .filter((part) => part !== '')
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease }
}

/** SemVer 2.0 precedence: a prerelease sorts before its release. */
export function compareSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const n = Math.min(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < n; i++) {
    const x = a.prerelease[i] as string | number
    const y = b.prerelease[i] as string | number
    if (x === y) continue
    // Numbers sort before strings; numbers numerically, strings lexically.
    if (typeof x === 'number' && typeof y === 'number') return x - y
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1
  }
  return a.prerelease.length - b.prerelease.length
}

export interface ReleaseCandidate {
  /** Without the leading v. */
  readonly version: string
  readonly url: string
}

interface ParsedRelease extends ReleaseCandidate {
  readonly semver: SemVer
  readonly prerelease: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Only a page on github.com may leave the app from here. */
function isReleasePage(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com'
  } catch {
    return false
  }
}

function parseRelease(entry: unknown): ParsedRelease | null {
  if (!isRecord(entry)) return null
  if (entry['draft'] === true) return null
  if (typeof entry['tag_name'] !== 'string') return null
  const semver = parseSemver(entry['tag_name'])
  if (semver === null) return null
  if (!isReleasePage(entry['html_url'])) return null
  return {
    version: entry['tag_name'].replace(/^v/, ''),
    url: entry['html_url'],
    semver,
    prerelease: entry['prerelease'] === true || semver.prerelease.length > 0,
  }
}

/**
 * The newest release the running build should hear about, or null.
 *
 * A stable build only hears about stable releases; a prerelease build hears
 * about both. A build newer than everything published is a local one and gets
 * nothing.
 */
export function pickUpdate(payload: unknown, currentVersion: string): ReleaseCandidate | null {
  if (!Array.isArray(payload)) return null
  const current = parseSemver(currentVersion)
  if (current === null) return null
  const acceptPrerelease = current.prerelease.length > 0

  let best: ParsedRelease | null = null
  for (const entry of payload) {
    const release = parseRelease(entry)
    if (release === null) continue
    if (release.prerelease && !acceptPrerelease) continue
    if (compareSemver(release.semver, current) <= 0) continue
    if (best === null || compareSemver(release.semver, best.semver) > 0) best = release
  }
  return best === null ? null : { version: best.version, url: best.url }
}
