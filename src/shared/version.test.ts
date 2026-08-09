import { describe, expect, it } from 'vitest'
import { windowTitle } from './version'

describe('windowTitle', () => {
  it('uses the app name alone with no session', () => {
    expect(windowTitle(null)).toBe('Termspace')
  })

  it('appends the session name', () => {
    expect(windowTitle('dev')).toBe('Termspace — dev')
  })
})
