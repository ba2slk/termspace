/**
 * Guards against xterm committing one composition twice.
 *
 * When a keydown carrying a real key code — not the composition code 229 —
 * arrives mid-composition, xterm's CompositionHelper sends the syllable at
 * once and the `compositionend` that follows sends the very same range again.
 * Its duplicate guard reads `_dataAlreadySent`, which that path never sets.
 *
 * The second send is the one to drop: by then the text has already left. So
 * the state here mirrors xterm's own composition flag from the same events and
 * swallows that one `compositionend` before xterm's listener runs.
 */

/** Keys xterm keeps composing through, so they trigger no early send. */
const COMPOSING_KEY_CODES = new Set([16, 17, 18, 20, 229])

export class ImeDoubleCommitGuard {
  private composing = false
  private earlySend = false

  compositionstart(): void {
    this.composing = true
    this.earlySend = false
  }

  keydown(keyCode: number): void {
    if (!this.composing || COMPOSING_KEY_CODES.has(keyCode)) return
    this.earlySend = true
  }

  /** True when xterm already sent this composition and must not send it again. */
  compositionend(): boolean {
    const swallow = this.earlySend
    this.composing = false
    this.earlySend = false
    return swallow
  }
}

/**
 * Capture-phase listeners run before xterm's, which are plain bubble-phase
 * listeners on the same textarea.
 */
export function guardImeDoubleCommit(textarea: HTMLTextAreaElement): void {
  const guard = new ImeDoubleCommitGuard()
  textarea.addEventListener('compositionstart', () => guard.compositionstart(), true)
  textarea.addEventListener('keydown', (ev) => guard.keydown(ev.keyCode), true)
  textarea.addEventListener(
    'compositionend',
    (ev) => {
      if (guard.compositionend()) ev.stopImmediatePropagation()
    },
    true,
  )
}
