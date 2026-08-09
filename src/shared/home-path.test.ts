import { describe, expect, it } from 'vitest'
import { shorten } from './home-path'

describe('shorten', () => {
  it('replaces home itself and paths under it', () => {
    expect(shorten('/home/u', '/home/u')).toBe('~')
    expect(shorten('/home/u/dev/app', '/home/u')).toBe('~/dev/app')
  })

  it('leaves everything else alone', () => {
    expect(shorten('/opt/x', '/home/u')).toBe('/opt/x')
    // A sibling that merely starts with the same characters is not under home.
    expect(shorten('/home/user2/dev', '/home/u')).toBe('/home/user2/dev')
  })

  it('does nothing without a home', () => {
    expect(shorten('/home/u/dev', '')).toBe('/home/u/dev')
  })
})
