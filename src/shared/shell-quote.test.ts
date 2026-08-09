import { describe, expect, it } from 'vitest'
import { shellQuote } from './shell-quote'

describe('shellQuote', () => {
  it('leaves an ordinary path alone', () => {
    expect(shellQuote('/home/me/notes.md')).toBe('/home/me/notes.md')
  })

  it('quotes a path with spaces', () => {
    expect(shellQuote('/home/me/my notes.md')).toBe("'/home/me/my notes.md'")
  })

  it('quotes non-ASCII names, which the pattern does not cover', () => {
    expect(shellQuote('/home/me/사진.png')).toBe("'/home/me/사진.png'")
  })

  it('closes, escapes and reopens around a single quote', () => {
    expect(shellQuote("/tmp/it's here")).toBe(`'/tmp/it'\\''s here'`)
  })

  it('quotes characters a shell would act on', () => {
    for (const path of ['/tmp/a;rm -rf b', '/tmp/$(id)', '/tmp/a`id`', '/tmp/a&b', '/tmp/a|b']) {
      expect(shellQuote(path).startsWith("'")).toBe(true)
    }
  })
})
