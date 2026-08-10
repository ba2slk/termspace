import { describe, expect, it } from 'vitest'
import {
  MAX_SEQUENCE_CHARS,
  NO_SIGNALS,
  scanTerminalSignals,
  type SignalState,
  type TerminalSignal,
} from './terminal-signals'

const ESC = '\u001b'
const BEL = '\u0007'
const ST = '\u001b\\'

/** One chunk, from a clean start. */
const scan = (chunk: string): readonly TerminalSignal[] =>
  scanTerminalSignals(NO_SIGNALS, chunk).signals

/** Several chunks, carrying state between them as the pty host does. */
function scanAll(...chunks: readonly string[]): readonly TerminalSignal[] {
  let state: SignalState = NO_SIGNALS
  const signals: TerminalSignal[] = []
  for (const chunk of chunks) {
    const result = scanTerminalSignals(state, chunk)
    state = result.state
    signals.push(...result.signals)
  }
  return signals
}

describe('the bell', () => {
  it('reports a bare BEL', () => {
    expect(scan(`done${BEL}`)).toEqual([{ kind: 'bell' }])
  })

  it('counts each one', () => {
    expect(scan(`${BEL}${BEL}`)).toHaveLength(2)
  })

  it('does not mistake an OSC terminator for a bell', () => {
    expect(scan(`${ESC}]2;build${BEL}`)).toEqual([{ kind: 'title', title: 'build' }])
  })

  it('stays quiet through ordinary output', () => {
    expect(scan('just some text\r\n')).toEqual([])
  })
})

describe('titles', () => {
  it('takes OSC 0 and OSC 2', () => {
    expect(scan(`${ESC}]0;icon and title${BEL}`)).toEqual([
      { kind: 'title', title: 'icon and title' },
    ])
    expect(scan(`${ESC}]2;title only${ST}`)).toEqual([{ kind: 'title', title: 'title only' }])
  })

  it('ignores OSC 1, which names the icon alone', () => {
    expect(scan(`${ESC}]1;icon${BEL}`)).toEqual([])
  })

  it('drops control characters, so chrome cannot be broken by a title', () => {
    expect(scan(`${ESC}]2;two\r\nlines${BEL}`)).toEqual([{ kind: 'title', title: 'two  lines' }])
  })

  it('ignores an empty title', () => {
    expect(scan(`${ESC}]2;${BEL}`)).toEqual([])
  })
})

describe('the working directory', () => {
  it('takes the path out of OSC 7', () => {
    expect(scan(`${ESC}]7;file://host/home/me/dev${BEL}`)).toEqual([
      { kind: 'cwd', path: '/home/me/dev' },
    ])
  })

  it('accepts an empty host', () => {
    expect(scan(`${ESC}]7;file:///tmp${ST}`)).toEqual([{ kind: 'cwd', path: '/tmp' }])
  })

  it('decodes percent-encoding, which is how a space arrives', () => {
    expect(scan(`${ESC}]7;file:///home/me/my%20work${BEL}`)).toEqual([
      { kind: 'cwd', path: '/home/me/my work' },
    ])
  })

  it('accepts a raw space, which some shells send unencoded', () => {
    expect(scan(`${ESC}]7;file://host/a b/c${BEL}`)).toEqual([{ kind: 'cwd', path: '/a b/c' }])
  })

  it('ignores anything that is not a file URI', () => {
    expect(scan(`${ESC}]7;/home/me${BEL}`)).toEqual([])
    expect(scan(`${ESC}]7;file://host${BEL}`)).toEqual([])
  })

  it('survives malformed percent-encoding rather than throwing', () => {
    expect(scan(`${ESC}]7;file:///bad%ZZ${BEL}`)).toEqual([])
  })
})

describe('notifications', () => {
  it('takes OSC 9 as a body with no title', () => {
    expect(scan(`${ESC}]9;build finished${BEL}`)).toEqual([
      { kind: 'notify', title: '', body: 'build finished' },
    ])
  })

  it('takes OSC 777 as title and body', () => {
    expect(scan(`${ESC}]777;notify;Build;3 tests failed${BEL}`)).toEqual([
      { kind: 'notify', title: 'Build', body: '3 tests failed' },
    ])
  })

  it('keeps semicolons inside the body of an OSC 777', () => {
    expect(scan(`${ESC}]777;notify;Done;a; b; c${BEL}`)).toEqual([
      { kind: 'notify', title: 'Done', body: 'a; b; c' },
    ])
  })

  it('ignores an OSC 777 that is not a notify', () => {
    expect(scan(`${ESC}]777;precmd${BEL}`)).toEqual([])
  })
})

describe('sequences split across reads', () => {
  it('joins an OSC broken anywhere', () => {
    expect(scanAll(`${ESC}]2;bui`, `ld${BEL}`)).toEqual([{ kind: 'title', title: 'build' }])
    expect(scanAll(ESC, `]2;build${BEL}`)).toEqual([{ kind: 'title', title: 'build' }])
    expect(scanAll(`${ESC}]2;build${ESC}`, '\\')).toEqual([{ kind: 'title', title: 'build' }])
  })

  it('does not lose a bell that follows a split sequence', () => {
    expect(scanAll(`${ESC}]2;x`, `${BEL}${BEL}`)).toEqual([
      { kind: 'title', title: 'x' },
      { kind: 'bell' },
    ])
  })
})

describe('what it refuses to be confused by', () => {
  it('walks past escape sequences it has no interest in', () => {
    expect(scan(`${ESC}[31mred${ESC}[0m${BEL}`)).toEqual([{ kind: 'bell' }])
  })

  it('does not treat an unknown OSC as anything', () => {
    expect(scan(`${ESC}]1337;File=name${BEL}`)).toEqual([])
    expect(scan(`${ESC}]133;A${BEL}`)).toEqual([])
  })

  it('gives up on a sequence whose terminator never comes', () => {
    const runaway = `${ESC}]2;${'x'.repeat(MAX_SEQUENCE_CHARS + 10)}`
    const result = scanTerminalSignals(NO_SIGNALS, runaway)
    expect(result.signals).toEqual([])
    expect(result.state.pending).toBe('')
  })

  it('restarts on a second escape rather than swallowing it', () => {
    expect(scan(`${ESC}${ESC}]2;build${BEL}`)).toEqual([{ kind: 'title', title: 'build' }])
  })

  it('reports several signals from one chunk, in order', () => {
    expect(scan(`${ESC}]2;vim${BEL}text${BEL}${ESC}]7;file:///tmp${BEL}`)).toEqual([
      { kind: 'title', title: 'vim' },
      { kind: 'bell' },
      { kind: 'cwd', path: '/tmp' },
    ])
  })
})
