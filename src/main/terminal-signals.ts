/**
 * The standard signals a program sends through the pty: the bell, and the OSC
 * sequences terminals have long agreed on. Pure.
 *
 * Unlike `shell-integration-osc`, which owns its sequences and strips them,
 * these belong to the terminal at large. Output passes through untouched — the
 * scanner only watches. That also means it never holds a chunk back waiting for
 * a terminator; the parse state lives here, not in the data path.
 *
 * Read in main rather than through xterm's parser because a pane off screen is
 * frozen, and its output sits queued in the renderer. That pane is exactly the
 * one whose bell matters.
 */

const ESC = '\u001b'
const BEL = '\u0007'
/** String Terminator: the other way an OSC ends. */
const ST = '\u001b\\'

/** A sequence longer than this is treated as a terminator that never came. */
export const MAX_SEQUENCE_CHARS = 8 * 1024

/** Titles and messages are shown in chrome, so they cannot run away. */
const MAX_TEXT_CHARS = 512

export type TerminalSignal =
  /** BEL outside any sequence. "Look at me", for forty years. */
  | { readonly kind: 'bell' }
  /** OSC 0 / 2 — the window title the program wants. */
  | { readonly kind: 'title'; readonly title: string }
  /** OSC 7 — where the shell actually is. */
  | { readonly kind: 'cwd'; readonly path: string }
  /** OSC 9 (iTerm2) and OSC 777 (urxvt) — an explicit desktop notification. */
  | { readonly kind: 'notify'; readonly title: string; readonly body: string }

/** Opaque carry: a sequence split across two reads. */
export interface SignalState {
  readonly pending: string
}

export const NO_SIGNALS: SignalState = { pending: '' }

export interface SignalScan {
  readonly state: SignalState
  readonly signals: readonly TerminalSignal[]
}

/**
 * Chrome draws these, so a newline or an escape inside one would either break
 * the layout or start a second sequence in whatever renders it.
 */
function clean(text: string): string {
  const bare = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return bare.length > MAX_TEXT_CHARS ? bare.slice(0, MAX_TEXT_CHARS) : bare
}

/**
 * OSC 7 carries `file://host/path`. The host is ignored: a shell reporting a
 * path it cannot see is a broken shell, and /proc has the same blind spot.
 */
function parseCwd(text: string): TerminalSignal | null {
  if (!text.startsWith('file://')) return null
  const rest = text.slice('file://'.length)
  const slash = rest.indexOf('/')
  if (slash === -1) return null
  try {
    const path = decodeURIComponent(rest.slice(slash))
    return path === '' ? null : { kind: 'cwd', path }
  } catch {
    return null // malformed percent-encoding
  }
}

/** `notify;title;body`, where the body may itself contain semicolons. */
function parseUrxvtNotify(text: string): TerminalSignal | null {
  if (!text.startsWith('notify;')) return null
  const rest = text.slice('notify;'.length)
  const split = rest.indexOf(';')
  const title = clean(split === -1 ? rest : rest.slice(0, split))
  const body = split === -1 ? '' : clean(rest.slice(split + 1))
  return title === '' && body === '' ? null : { kind: 'notify', title, body }
}

/** The body of one OSC, terminator already removed. */
function parseOsc(body: string): TerminalSignal | null {
  const semi = body.indexOf(';')
  if (semi === -1) return null
  const code = body.slice(0, semi)
  const text = body.slice(semi + 1)

  switch (code) {
    // 0 sets icon and title together, 2 the title alone. 1 is the icon only,
    // which nothing here shows.
    case '0':
    case '2': {
      const title = clean(text)
      return title === '' ? null : { kind: 'title', title }
    }
    case '7':
      return parseCwd(text)
    case '9': {
      const message = clean(text)
      return message === '' ? null : { kind: 'notify', title: '', body: message }
    }
    case '777':
      return parseUrxvtNotify(text)
    default:
      return null
  }
}

/**
 * Watch one chunk of pty output. The chunk itself is the caller's to forward
 * unchanged — nothing here consumes it.
 */
export function scanTerminalSignals(state: SignalState, chunk: string): SignalScan {
  const signals: TerminalSignal[] = []
  let pending = state.pending

  for (const char of chunk) {
    // Not inside anything: only ESC and a bare BEL mean something.
    if (pending === '') {
      if (char === ESC) pending = ESC
      else if (char === BEL) signals.push({ kind: 'bell' })
      continue
    }

    /*
     * ESC starts far more than OSC — CSI, charset selection, and the rest.
     * Anything whose second character is not `]` is dropped here rather than
     * parsed: this scanner has no interest in it.
     */
    if (pending === ESC) {
      if (char === ']') pending = `${ESC}]`
      else if (char === ESC) pending = ESC // a new escape restarts the wait
      else pending = ''
      continue
    }

    // Inside an OSC. A BEL here terminates it; it is not the bell.
    if (char === BEL) {
      const signal = parseOsc(pending.slice(2))
      if (signal !== null) signals.push(signal)
      pending = ''
      continue
    }

    pending += char
    if (pending.endsWith(ST)) {
      const signal = parseOsc(pending.slice(2, -ST.length))
      if (signal !== null) signals.push(signal)
      pending = ''
      continue
    }
    // A terminator that never came: a binary file catted into the pane would
    // otherwise grow this forever.
    if (pending.length > MAX_SEQUENCE_CHARS) pending = ''
  }

  return { state: { pending }, signals }
}
