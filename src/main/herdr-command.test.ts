import { describe, expect, it } from 'vitest'
import {
  herdrAttachCommand,
  herdrSessionFromCommand,
  isHerdrName,
  nextHerdrName,
  sessionStem,
} from './herdr-command'

describe('herdrSessionFromCommand', () => {
  it('reads --session', () => {
    expect(herdrSessionFromCommand('herdr --session termspace-1')).toBe('termspace-1')
  })
  it('reads session attach', () => {
    expect(herdrSessionFromCommand('herdr session attach portfolio')).toBe('portfolio')
  })
  it('bare herdr is the default session', () => {
    expect(herdrSessionFromCommand('herdr')).toBe('default')
    expect(herdrSessionFromCommand('  herdr  ')).toBe('default')
  })
  it('ignores other herdr subcommands', () => {
    expect(herdrSessionFromCommand('herdr session list')).toBeNull()
    expect(herdrSessionFromCommand('herdr session stop x')).toBeNull()
    expect(herdrSessionFromCommand('herdr --version')).toBeNull()
  })
  it('ignores other programs and a path that merely contains herdr', () => {
    expect(herdrSessionFromCommand('claude')).toBeNull()
    expect(herdrSessionFromCommand('vim herdr.toml')).toBeNull()
    expect(herdrSessionFromCommand('')).toBeNull()
  })
  it('accepts an absolute herdr binary, as /proc reports it', () => {
    expect(herdrSessionFromCommand('/home/u/.local/bin/herdr --session a.b_c')).toBe('a.b_c')
  })
  it('rejects a name herdr would reject', () => {
    expect(herdrSessionFromCommand('herdr --session "no such"')).toBeNull()
  })
})

describe('isHerdrName', () => {
  it('accepts what herdr accepts', () => {
    expect(isHerdrName('a.b_c-1')).toBe(true)
    expect(isHerdrName('no such')).toBe(false)
    expect(isHerdrName('')).toBe(false)
    expect(isHerdrName('한글')).toBe(false)
  })
})

describe('herdrAttachCommand', () => {
  it('is the --session form', () => {
    expect(herdrAttachCommand('termspace-2')).toBe('herdr --session termspace-2')
  })
  it('round-trips through the parser', () => {
    expect(herdrSessionFromCommand(herdrAttachCommand('default'))).toBe('default')
  })
})

describe('sessionStem', () => {
  it('lowers and keeps herdr-legal characters', () => {
    expect(sessionStem('Termspace')).toBe('termspace')
    expect(sessionStem('cat.ch_up-1')).toBe('cat.ch_up-1')
  })
  it('replaces what herdr rejects and collapses runs', () => {
    expect(sessionStem('My Project')).toBe('my-project')
    expect(sessionStem('a  /  b')).toBe('a-b')
  })
  it('falls back when nothing legal is left', () => {
    expect(sessionStem('내 작업')).toBe('termspace')
    expect(sessionStem('')).toBe('termspace')
    expect(sessionStem(null)).toBe('termspace')
  })
  it('never starts or ends with a dash', () => {
    expect(sessionStem('-x-')).toBe('x')
  })
})

describe('nextHerdrName', () => {
  it('starts at 1', () => {
    expect(nextHerdrName('termspace', [])).toBe('termspace-1')
  })
  it('skips taken numbers, including stopped sessions', () => {
    expect(nextHerdrName('termspace', ['termspace-1', 'termspace-2', 'other'])).toBe('termspace-3')
  })
  it('fills the first gap', () => {
    expect(nextHerdrName('termspace', ['termspace-2'])).toBe('termspace-1')
  })
})
