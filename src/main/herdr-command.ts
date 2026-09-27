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
