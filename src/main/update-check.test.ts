import { describe, expect, it } from 'vitest'
import { compareSemver, parseSemver, pickUpdate } from './update-check'

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/ba2slk/termspace/releases/tag/${tag}`,
  draft: false,
  prerelease: tag.includes('-'),
  ...extra,
})

describe('parseSemver', () => {
  it('reads a plain version, with or without the v', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseSemver('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
  })

  it('splits the prerelease part, numbers as numbers', () => {
    expect(parseSemver('1.1.0-beta.4')).toEqual({ major: 1, minor: 1, patch: 0, prerelease: ['beta', 4] })
  })

  it('returns null for anything else', () => {
    expect(parseSemver('1.2')).toBeNull()
    expect(parseSemver('nightly')).toBeNull()
    expect(parseSemver('')).toBeNull()
  })
})

describe('compareSemver', () => {
  const v = (s: string) => parseSemver(s)!
  it('orders by major, minor, patch', () => {
    expect(compareSemver(v('1.0.0'), v('1.0.1'))).toBeLessThan(0)
    expect(compareSemver(v('1.10.0'), v('1.9.9'))).toBeGreaterThan(0)
    expect(compareSemver(v('2.0.0'), v('2.0.0'))).toBe(0)
  })
  it('puts a prerelease before its release, and orders prereleases', () => {
    expect(compareSemver(v('1.1.0-beta.4'), v('1.1.0'))).toBeLessThan(0)
    expect(compareSemver(v('1.1.0'), v('1.1.1'))).toBeLessThan(0)
    expect(compareSemver(v('1.1.0-beta.4'), v('1.1.0-beta.10'))).toBeLessThan(0)
    expect(compareSemver(v('1.1.0-alpha.1'), v('1.1.0-beta.1'))).toBeLessThan(0)
  })
})

describe('pickUpdate', () => {
  it('offers the newest stable release above a stable build', () => {
    const picked = pickUpdate([release('v1.0.0'), release('v1.2.0'), release('v1.1.0')], '1.0.0')
    expect(picked).toEqual({ version: '1.2.0', url: 'https://github.com/ba2slk/termspace/releases/tag/v1.2.0' })
  })

  it('reports nothing when the running version is the newest', () => {
    expect(pickUpdate([release('v1.0.0'), release('v1.1.0')], '1.1.0')).toBeNull()
  })

  it('reports nothing for a local build newer than anything published', () => {
    expect(pickUpdate([release('v1.0.0'), release('v1.1.0')], '1.2.0')).toBeNull()
  })

  it('hides prereleases from a stable build', () => {
    expect(pickUpdate([release('v1.0.0'), release('v1.1.0-beta.4')], '1.0.0')).toBeNull()
  })

  it('shows prereleases to a prerelease build', () => {
    expect(pickUpdate([release('v1.1.0-beta.3'), release('v1.1.0-beta.4')], '1.1.0-beta.3')?.version).toBe('1.1.0-beta.4')
  })

  it('never offers a beta build an older stable', () => {
    expect(pickUpdate([release('v1.0.0'), release('v1.1.0-beta.4')], '1.1.0-beta.4')).toBeNull()
  })

  it('offers a beta build the stable that supersedes it', () => {
    expect(pickUpdate([release('v1.1.0-beta.4'), release('v1.1.0')], '1.1.0-beta.4')?.version).toBe('1.1.0')
  })

  it('treats a release GitHub flags as prerelease that way even with a plain tag', () => {
    expect(pickUpdate([release('v1.5.0', { prerelease: true })], '1.0.0')).toBeNull()
  })

  it('skips drafts, unparseable tags and malformed entries', () => {
    const payload = [
      release('v9.0.0', { draft: true }),
      release('nightly'),
      { html_url: 'x' },
      'garbage',
      release('v1.0.1'),
    ]
    expect(pickUpdate(payload, '1.0.0')?.version).toBe('1.0.1')
  })

  it('returns null for a payload that is not a list, or a version that does not parse', () => {
    expect(pickUpdate({ message: 'rate limited' }, '1.0.0')).toBeNull()
    expect(pickUpdate([release('v1.0.1')], 'dev')).toBeNull()
  })

  it('requires the html_url to be an https github.com page', () => {
    expect(pickUpdate([release('v1.0.1', { html_url: 'file:///etc/passwd' })], '1.0.0')).toBeNull()
  })
})
