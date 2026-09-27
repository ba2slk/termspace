import { describe, expect, it } from 'vitest'
import { createPageWebglCoordinator, type WebglContextHolder } from './page-webgl-coordinator'

describe('page WebGL coordinator', () => {
  it('counts contexts across sessions and reclaims only inactive other sessions', () => {
    const coordinator = createPageWebglCoordinator()
    const makeHolder = (active: boolean, contexts: number) => {
      let held = contexts
      const holder: WebglContextHolder = {
        isActive: () => active,
        held: () => held,
        release: (count) => {
          const released = Math.min(count, held)
          held -= released
          return released
        },
      }
      return { holder, held: () => held }
    }

    const inactive = makeHolder(false, 3)
    const active = makeHolder(true, 4)
    const mine = makeHolder(true, 2)
    const unregisterInactive = coordinator.register(inactive.holder)
    const unregisterActive = coordinator.register(active.holder)
    coordinator.register(mine.holder)

    expect(coordinator.heldContexts()).toBe(9)
    coordinator.reclaimInactive(5, mine.holder)

    expect(inactive.held()).toBe(0)
    expect(active.held()).toBe(4)
    expect(mine.held()).toBe(2)
    expect(coordinator.heldContexts()).toBe(6)

    unregisterInactive()
    expect(coordinator.heldContexts()).toBe(6)
    unregisterActive()
    expect(coordinator.heldContexts()).toBe(2)
  })
})
