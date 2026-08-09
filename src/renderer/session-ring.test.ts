import { describe, expect, it } from 'vitest'
import { stepSession } from './session-ring'

describe('stepSession', () => {
  const ring = ['api', 'web', 'logs']

  it('steps to the next session in list order', () => {
    expect(stepSession(ring, 'api', 1)).toBe('web')
    expect(stepSession(ring, 'web', 1)).toBe('logs')
  })

  it('steps to the previous session in list order', () => {
    expect(stepSession(ring, 'logs', -1)).toBe('web')
    expect(stepSession(ring, 'web', -1)).toBe('api')
  })

  it('wraps around both ends', () => {
    expect(stepSession(ring, 'logs', 1)).toBe('api')
    expect(stepSession(ring, 'api', -1)).toBe('logs')
  })

  it('does nothing when the ring holds one session or none', () => {
    expect(stepSession(['api'], 'api', 1)).toBeNull()
    expect(stepSession(['api'], 'api', -1)).toBeNull()
    expect(stepSession([], null, 1)).toBeNull()
  })

  // Nothing open yet: the shortcut should still land somewhere sensible.
  it('enters the ring at the end the step comes from', () => {
    expect(stepSession(ring, null, 1)).toBe('api')
    expect(stepSession(ring, null, -1)).toBe('logs')
    expect(stepSession(ring, 'gone', 1)).toBe('api')
  })
})
