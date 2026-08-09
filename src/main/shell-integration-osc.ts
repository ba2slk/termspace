/**
 * The private OSC sequences the bash hook writes into the pty.
 *
 * A pane's shell reports the line it is about to run, before alias expansion —
 * something /proc can never recover. Parsing is pure; the wiring lives in
 * pty-host, which strips these before the data reaches the terminal.
 *
 * 1173 is private: OSC 133, 633 and 1337 already carry meaning elsewhere.
 */

const PREFIX = '\u001b]1173;'
const BEL = '\u0007'

/** A sequence longer than this is treated as a terminator that never came. */
export const MAX_SEQUENCE_CHARS = 8 * 1024

export type ShellIntegrationEvent =
  | { readonly kind: 'sourced' }
  | { readonly kind: 'command'; readonly command: string }

export interface ScanResult {
  /** The chunk with our sequences removed, safe to hand to the terminal. */
  readonly output: string
  /** An unfinished sequence, to be passed back as the next call's carry. */
  readonly carry: string
  readonly events: readonly ShellIntegrationEvent[]
}

/** Base64 as the hook emits it; anything else means a corrupted payload. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

function parseBody(body: string): ShellIntegrationEvent | null {
  if (body === 'A') return { kind: 'sourced' }
  if (!body.startsWith('C;')) return null
  const payload = body.slice(2)
  if (!BASE64.test(payload)) return null
  const command = Buffer.from(payload, 'base64').toString('utf8').trim()
  return command === '' ? null : { kind: 'command', command }
}

/** How much of the tail could still grow into a prefix, so it must be held back. */
function danglingPrefixLength(text: string): number {
  const most = Math.min(text.length, PREFIX.length - 1)
  for (let length = most; length > 0; length--) {
    if (text.endsWith(PREFIX.slice(0, length))) return length
  }
  return 0
}

/** Split pty output into terminal-bound text and the events the hook sent. */
export function scanShellIntegration(carry: string, chunk: string): ScanResult {
  const data = carry + chunk
  const events: ShellIntegrationEvent[] = []
  let output = ''
  let cursor = 0

  for (;;) {
    const start = data.indexOf(PREFIX, cursor)
    if (start === -1) break
    output += data.slice(cursor, start)

    const end = data.indexOf(BEL, start + PREFIX.length)
    if (end === -1) {
      // Still open. Hold it unless it has grown past anything the hook would send.
      const held = data.length - start
      return { output, carry: held > MAX_SEQUENCE_CHARS ? '' : data.slice(start), events }
    }

    const event = parseBody(data.slice(start + PREFIX.length, end))
    if (event !== null) events.push(event)
    cursor = end + BEL.length
  }

  const rest = data.slice(cursor)
  const dangling = danglingPrefixLength(rest)
  return {
    output: output + rest.slice(0, rest.length - dangling),
    carry: rest.slice(rest.length - dangling),
    events,
  }
}
