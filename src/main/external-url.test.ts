import { describe, expect, it } from 'vitest'
import { isOpenableUrl } from './external-url'

describe('isOpenableUrl', () => {
  it('allows the three schemes a terminal link is expected to use', () => {
    expect(isOpenableUrl('http://example.com')).toBe(true)
    expect(isOpenableUrl('https://example.com/a?b=c#d')).toBe(true)
    expect(isOpenableUrl('mailto:someone@example.com')).toBe(true)
  })

  it('is case-insensitive about the scheme, as URL parsing is', () => {
    expect(isOpenableUrl('HTTPS://example.com')).toBe(true)
  })

  it('denies schemes that can launch a program', () => {
    expect(isOpenableUrl('file:///etc/passwd')).toBe(false)
    expect(isOpenableUrl('javascript:alert(1)')).toBe(false)
    expect(isOpenableUrl('data:text/html,<script>')).toBe(false)
    expect(isOpenableUrl('vscode://file/etc/passwd')).toBe(false)
    expect(isOpenableUrl('ftp://example.com')).toBe(false)
  })

  it('denies anything that is not a URL, without throwing', () => {
    expect(isOpenableUrl('')).toBe(false)
    expect(isOpenableUrl('example.com')).toBe(false)
    expect(isOpenableUrl('   ')).toBe(false)
    expect(isOpenableUrl(undefined)).toBe(false)
    expect(isOpenableUrl(null)).toBe(false)
    expect(isOpenableUrl(42)).toBe(false)
  })
})
