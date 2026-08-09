import { describe, expect, it } from 'vitest'
import { MAX_SEQUENCE_CHARS, scanShellIntegration } from './shell-integration-osc'

/** What the hook emits for a submitted line. */
function seq(command: string): string {
  return `\u001b]1173;C;${Buffer.from(command, 'utf8').toString('base64')}\u0007`
}

const SOURCED = '\u001b]1173;A\u0007'

function scanAll(chunks: readonly string[]): { output: string; events: unknown[] } {
  let carry = ''
  let output = ''
  const events: unknown[] = []
  for (const chunk of chunks) {
    const result = scanShellIntegration(carry, chunk)
    carry = result.carry
    output += result.output
    events.push(...result.events)
  }
  return { output, events }
}

describe('scanShellIntegration', () => {
  it('passes ordinary output through untouched', () => {
    const result = scanShellIntegration('', 'hello \u001b[31mworld\u001b[0m\r\n')
    expect(result.output).toBe('hello \u001b[31mworld\u001b[0m\r\n')
    expect(result.events).toEqual([])
    expect(result.carry).toBe('')
  })

  it('reads a submitted command and keeps it off the screen', () => {
    const result = scanShellIntegration('', `before${seq('qatn')}after`)
    expect(result.output).toBe('beforeafter')
    expect(result.events).toEqual([{ kind: 'command', command: 'qatn' }])
  })

  it('reads the sourced marker', () => {
    const result = scanShellIntegration('', `${SOURCED}$ `)
    expect(result.output).toBe('$ ')
    expect(result.events).toEqual([{ kind: 'sourced' }])
  })

  it('carries a sequence split across chunks', () => {
    const whole = `a${seq('npm run dev')}b`
    for (let cut = 1; cut < whole.length; cut++) {
      const { output, events } = scanAll([whole.slice(0, cut), whole.slice(cut)])
      expect(output).toBe('ab')
      expect(events).toEqual([{ kind: 'command', command: 'npm run dev' }])
    }
  })

  it('does not buffer output that merely ends mid-escape', () => {
    // A lone ESC that turns out to start a colour code must not be held back.
    const { output, events } = scanAll(['x\u001b', '[0mY'])
    expect(output).toBe('x\u001b[0mY')
    expect(events).toEqual([])
  })

  it('survives payloads containing the delimiters', () => {
    const nasty = 'echo "a;b" && printf \'\\a\'\nmore'
    const result = scanShellIntegration('', seq(nasty))
    expect(result.events).toEqual([{ kind: 'command', command: nasty }])
    expect(result.output).toBe('')
  })

  it('keeps several sequences in one chunk', () => {
    const result = scanShellIntegration('', `${SOURCED}p${seq('ls')}q${seq('htop')}`)
    expect(result.output).toBe('pq')
    expect(result.events).toEqual([
      { kind: 'sourced' },
      { kind: 'command', command: 'ls' },
      { kind: 'command', command: 'htop' },
    ])
  })

  it('drops a sequence whose terminator never arrives', () => {
    const runaway = `\u001b]1173;C;${'A'.repeat(MAX_SEQUENCE_CHARS)}`
    const result = scanShellIntegration('', `keep${runaway}`)
    expect(result.output).toBe('keep')
    expect(result.events).toEqual([])
    expect(result.carry).toBe('')
  })

  it('ignores a payload that is not base64', () => {
    const result = scanShellIntegration('', '\u001b]1173;C;not base64!\u0007tail')
    expect(result.output).toBe('tail')
    expect(result.events).toEqual([])
  })

  it('ignores an unknown sub-command', () => {
    const result = scanShellIntegration('', '\u001b]1173;Z;whatever\u0007tail')
    expect(result.output).toBe('tail')
    expect(result.events).toEqual([])
  })

  it('reports an empty command line as no event', () => {
    const result = scanShellIntegration('', seq('   '))
    expect(result.events).toEqual([])
    expect(result.output).toBe('')
  })
})
