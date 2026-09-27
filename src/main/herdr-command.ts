/**
 * What a pane's shell line says about herdr, and how a new session is named.
 *
 * Pure. The lines come from the shell hook or /proc; the names go back into a
 * shell line or to the herdr CLI. Nothing here runs the binary.
 */

/** herdr's own rule for session names. */
const NAME = /^[A-Za-z0-9._-]+$/

export function isHerdrName(name: string): boolean {
  return NAME.test(name)
}

/** `herdr` or a path ending in it, as the shell hook or /proc reports it. */
function isHerdrBinary(word: string): boolean {
  return word === 'herdr' || word.endsWith('/herdr')
}

export function herdrSessionFromCommand(line: string): string | null {
  const words = line.trim().split(/\s+/)
  const first = words[0]
  if (first === undefined || first === '' || !isHerdrBinary(first)) return null
  if (words.length === 1) return 'default'
  let name: string | undefined
  if (words[1] === '--session') name = words[2]
  else if (words[1] === 'session' && words[2] === 'attach') name = words[3]
  if (name === undefined || !isHerdrName(name)) return null
  return name
}

export function herdrAttachCommand(name: string): string {
  return `herdr --session ${name}`
}

export function sessionStem(id: string | null): string {
  const stem = (id ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return stem === '' ? 'termspace' : stem
}

export function nextHerdrName(stem: string, taken: readonly string[]): string {
  const used = new Set(taken)
  for (let n = 1; ; n += 1) {
    const name = `${stem}-${String(n)}`
    if (!used.has(name)) return name
  }
}

const LOGIN_SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash'])

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function list(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record).filter((v): v is Record<string, unknown> => v !== null) : []
}

/** herdr's error, when a reply carries one. */
export function herdrError(json: unknown): { readonly code: string; readonly message: string } | null {
  const error = record(record(json)?.['error'])
  if (error === null) return null
  return {
    code: typeof error['code'] === 'string' ? error['code'] : 'unknown',
    message: typeof error['message'] === 'string' ? error['message'] : '',
  }
}

/** Session names from `herdr session list --json`, running or not. */
export function sessionNamesFrom(json: unknown): readonly string[] {
  return list(record(json)?.['sessions'])
    .map((s) => s['name'])
    .filter((n): n is string => typeof n === 'string')
}

/** Pane ids from `herdr api snapshot`; an empty list is a server still starting. */
export function paneIdsFrom(snapshotJson: unknown): readonly string[] {
  const snapshot = record(record(record(snapshotJson)?.['result'])?.['snapshot'])
  return list(snapshot?.['panes'])
    .map((p) => p['pane_id'])
    .filter((id): id is string => typeof id === 'string')
}

/**
 * The foreground of a pane from `herdr pane process-info`: null for an idle
 * login shell, the command line otherwise. A shell counts as idle only when
 * its arguments are all flags (`bash -l`); `bash deploy.sh` is a script
 * running. Without an `argv` array, the name alone decides.
 */
export function foregroundFrom(processInfoJson: unknown): string | null {
  const info = record(record(record(processInfoJson)?.['result'])?.['process_info'])
  const first = list(info?.['foreground_processes'])[0]
  if (first === undefined) return null
  const name = first['name']
  const cmdline = first['cmdline']
  if (typeof name !== 'string' || typeof cmdline !== 'string') return null
  // The shell alone in the foreground is an idle pane, whatever its path.
  if (!LOGIN_SHELLS.has(name)) return cmdline
  const argv = first['argv']
  if (!Array.isArray(argv)) return null
  const flagsOnly = argv.slice(1).every((arg) => typeof arg === 'string' && arg.startsWith('-'))
  return flagsOnly ? null : cmdline
}
