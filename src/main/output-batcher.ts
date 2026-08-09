/**
 * Batch pty output per frame.
 *
 * A pty can emit thousands of data events per second; one IPC message each
 * would cost more than rendering. Flush on the frame tick or the buffer cap,
 * whichever comes first. Knows only callbacks and timers.
 */
export interface BatcherOptions {
  readonly flushIntervalMs: number
  /**
   * Past this in one frame, flush immediately and pause that pty.
   * Character count approximates bytes closely enough for terminal output.
   */
  readonly highWaterMarkChars: number
  readonly onFlush: (paneId: string, data: string) => void
  readonly onPause: (paneId: string) => void
  readonly onResume: (paneId: string) => void
}

export class OutputBatcher {
  private readonly pending = new Map<string, string[]>()
  private readonly paused = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private disposed = false

  constructor(private readonly options: BatcherOptions) {}

  push(paneId: string, chunk: string): void {
    if (this.disposed) return

    const chunks = this.pending.get(paneId)
    if (chunks === undefined) this.pending.set(paneId, [chunk])
    else chunks.push(chunk)

    const size = this.pending.get(paneId)!.reduce((a, c) => a + c.length, 0)
    if (size >= this.options.highWaterMarkChars) {
      // One noisy pane must not starve the others.
      this.paused.add(paneId)
      this.options.onPause(paneId)
      this.flushPane(paneId)
    }

    // A paused pane still needs the timer, or it never resumes.
    this.ensureTimer()
  }

  /** Flush one pane now, without waiting for the frame. Used just before exit. */
  flushPane(paneId: string): void {
    const chunks = this.pending.get(paneId)
    if (chunks === undefined || chunks.length === 0) return
    this.pending.delete(paneId)
    this.options.onFlush(paneId, chunks.join(''))
  }

  /** Pane is gone; drop whatever is buffered. */
  drop(paneId: string): void {
    this.pending.delete(paneId)
    this.paused.delete(paneId)
  }

  dispose(): void {
    this.disposed = true
    this.stopTimer()
    this.pending.clear()
    // Resume anything paused, or that process is never read again.
    for (const paneId of [...this.paused]) this.options.onResume(paneId)
    this.paused.clear()
  }

  private ensureTimer(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => this.tick(), this.options.flushIntervalMs)
  }

  private stopTimer(): void {
    if (this.timer === null) return
    clearInterval(this.timer)
    this.timer = null
  }

  private tick(): void {
    for (const paneId of [...this.pending.keys()]) this.flushPane(paneId)
    for (const paneId of [...this.paused]) {
      this.paused.delete(paneId)
      this.options.onResume(paneId)
    }
    // Nothing to send — stop waking up every frame.
    if (this.pending.size === 0) this.stopTimer()
  }
}
