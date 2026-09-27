/** Coordinates WebGL slots shared by session runtimes in one renderer page. */
export interface WebglContextHolder {
  readonly isActive: () => boolean
  readonly held: () => number
  /** Give up at most `count` contexts; returns how many actually went. */
  readonly release: (count: number) => number
}

export interface PageWebglCoordinator {
  /** Register a session holder and return its removal function. */
  register(holder: WebglContextHolder): () => void
  heldContexts(): number
  /** Take slots back from inactive sessions, oldest holder first. */
  reclaimInactive(count: number, mine: WebglContextHolder): void
}

export function createPageWebglCoordinator(): PageWebglCoordinator {
  const holders = new Set<WebglContextHolder>()

  return {
    register(holder) {
      holders.add(holder)
      return () => {
        holders.delete(holder)
      }
    },
    heldContexts() {
      let total = 0
      for (const holder of holders) total += holder.held()
      return total
    },
    reclaimInactive(count, mine) {
      let freed = 0
      for (const holder of holders) {
        if (freed >= count) return
        if (holder === mine || holder.isActive()) continue
        freed += holder.release(count - freed)
      }
    },
  }
}
