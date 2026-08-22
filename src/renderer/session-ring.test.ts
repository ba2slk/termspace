import { describe, expect, it } from 'vitest'
import { gotoTarget, reachableSessions, stepSession } from './session-ring'

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

describe('the session a numbered key opens', () => {
  const rows = [
    { id: 'work', broken: false },
    { id: 'notes', broken: false },
    { id: 'bad', broken: true },
  ]

  it('opens the row at that index', () => {
    expect(gotoTarget(rows, 1, 'work', null)).toBe('notes')
  })

  it('has nowhere to go past the end of the list', () => {
    expect(gotoTarget(rows, 7, 'work', null)).toBeNull()
  })

  it('refuses a row whose file would not load', () => {
    expect(gotoTarget(rows, 2, 'work', null)).toBeNull()
  })

  /* The same key twice is a there-and-back, not a no-op. */
  it('goes back when it names the session already on screen', () => {
    expect(gotoTarget(rows, 0, 'work', 'notes')).toBe('notes')
  })

  it('stays put when there is nothing behind you', () => {
    expect(gotoTarget(rows, 0, 'work', null)).toBeNull()
  })

  /* Bouncing back beats the broken flag: you were in it, so it is live. */
  it('bounces back off the current row even when the list calls it broken', () => {
    expect(gotoTarget([{ id: 'work', broken: true }], 0, 'work', 'notes')).toBe('notes')
  })

  it('opens the first row with nothing on the canvas', () => {
    expect(gotoTarget(rows, 0, null, null)).toBe('work')
  })
})

describe('reachableSessions', () => {
  const sessions = [
    { id: 'api', archived: false },
    { id: 'old', archived: true },
    { id: 'web', archived: false },
  ]

  it('drops the archived ones', () => {
    expect(reachableSessions(sessions).map((s) => s.id)).toEqual(['api', 'web'])
  })

  /*
   * The sidebar numbers the same list, so Alt+N and the row it points at have to
   * skip the same sessions.
   */
  it('keeps the order of what is left, so Alt+N still counts rows', () => {
    expect(reachableSessions([{ id: 'old', archived: true }, ...sessions]).map((s) => s.id))
      .toEqual(['api', 'web'])
  })

  it('passes an unarchived list through', () => {
    const open = [{ id: 'api', archived: false }]
    expect(reachableSessions(open)).toEqual(open)
  })
})
