/**
 * Diagnostic ring buffer for the intermittent Korean double-input bug
 * (docs/engineering-notes.md, "Hangul double input"). Records the raw event stream
 * around the IME so that when the double fires, the exact sequence — which
 * keydown carried keyCode 229, whether compositionend and the input event both
 * committed — is on record. Remove once the trigger is pinned down.
 */

export interface ImeTraceEntry {
  /** performance.now() at the time of the event. */
  readonly at: number
  readonly kind: string
  readonly detail: string
}

// Hangul compatibility jamo (U+3130–318F) and syllables (U+AC00–D7AF).
const HANGUL = /[\u3130-\u318f\uac00-\ud7af]/

/**
 * A committed syllable takes several keystrokes to compose, so the same
 * Hangul data twice within this window cannot be honest typing.
 */
const DOUBLE_WINDOW_MS = 150

export class ImeTrace {
  private readonly entries: ImeTraceEntry[] = []
  private lastData: { at: number; data: string } | null = null

  constructor(private readonly capacity = 64) {}

  record(at: number, kind: string, detail: string): void {
    this.entries.push({ at, kind, detail })
    if (this.entries.length > this.capacity) this.entries.shift()
  }

  /**
   * Record data leaving for the pty. Returns true when it repeats the previous
   * send fast enough to be a double commit rather than typing.
   */
  recordData(at: number, data: string): boolean {
    this.record(at, 'data', JSON.stringify(data))
    const previous = this.lastData
    this.lastData = { at, data }
    return (
      previous !== null &&
      previous.data === data &&
      at - previous.at <= DOUBLE_WINDOW_MS &&
      HANGUL.test(data)
    )
  }

  dump(): readonly ImeTraceEntry[] {
    return [...this.entries]
  }
}
