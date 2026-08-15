import { describe, expect, it } from 'vitest'
import { parseTheme } from './theme-config'
import { DEFAULT_THEME } from '../shared/terminal-themes'

const full = (): Record<string, string> => {
  const { id: _id, label: _label, credit: _credit, ...colors } = DEFAULT_THEME
  return { ...colors }
}

describe('parseTheme', () => {
  it('accepts a complete palette', () => {
    const theme = parseTheme('mine', { label: '내 배색', ...full() })
    expect(theme?.id).toBe('mine')
    expect(theme?.label).toBe('내 배색')
    expect(theme?.background).toBe(DEFAULT_THEME.background)
  })

  it('falls back to the file name for a label', () => {
    expect(parseTheme('mine', full())?.label).toBe('mine')
  })

  it('rejects the file if any colour is missing', () => {
    // Accepting part of it would build a palette of unknown provenance.
    const partial = full()
    delete partial['brightCyan']
    expect(parseTheme('mine', partial)).toBeNull()
  })

  it('rejects values that are not colours', () => {
    // These reach a CSS declaration and must not escape it.
    expect(parseTheme('mine', { ...full(), red: 'red; position: fixed' })).toBeNull()
    expect(parseTheme('mine', { ...full(), red: '#12345' })).toBeNull()
    expect(parseTheme('mine', { ...full(), red: 42 })).toBeNull()
  })

  it('accepts rgba(), which suits the selection colour', () => {
    expect(parseTheme('mine', { ...full(), selection: 'rgba(255,255,255,0.2)' })).not.toBeNull()
  })

  it('takes the accent from the file when it names one', () => {
    expect(parseTheme('mine', { ...full(), accent: '#ff0000' })?.accent).toBe('#ff0000')
  })

  it('reads a palette with no accent as meaning its blue', () => {
    const noAccent = full()
    delete noAccent['accent']
    expect(parseTheme('mine', noAccent)?.accent).toBe(DEFAULT_THEME.blue)
  })

  it('rejects an accent that is not a colour', () => {
    expect(parseTheme('mine', { ...full(), accent: 'blue; position: fixed' })?.accent).toBe(
      DEFAULT_THEME.blue,
    )
  })

  it('rejects non-objects', () => {
    expect(parseTheme('mine', null)).toBeNull()
    expect(parseTheme('mine', '색')).toBeNull()
  })
})
