import { describe, expect, it } from 'vitest'
import { configDir } from './config-dir'

describe('configDir', () => {
  it('follows XDG_CONFIG_HOME when set', () => {
    expect(configDir({ XDG_CONFIG_HOME: '/x/cfg', HOME: '/home/u' } as NodeJS.ProcessEnv)).toBe(
      '/x/cfg/termspace',
    )
  })

  it('falls back to ~/.config without XDG_CONFIG_HOME', () => {
    expect(configDir({ HOME: '/home/u' } as NodeJS.ProcessEnv)).toBe('/home/u/.config/termspace')
  })

  // No HOME is a broken environment, but a relative path beats a crash at startup.
  it('degrades to a relative path when HOME is missing too', () => {
    expect(configDir({} as NodeJS.ProcessEnv)).toBe('.config/termspace')
  })
})
