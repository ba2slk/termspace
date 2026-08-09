import { describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { guardImeDoubleCommit } from './ime-double-commit'

/**
 * Drives a real xterm, because the double send lives in its CompositionHelper.
 * Testing our own state machine alone would never have caught it.
 */
async function compose(guarded: boolean): Promise<string[]> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const term = new Terminal({ allowProposedApi: true })
  term.open(host)

  const sent: string[] = []
  term.onData((data) => sent.push(data))

  const textarea = host.querySelector('textarea')!
  if (guarded) guardImeDoubleCommit(textarea)

  textarea.dispatchEvent(new CompositionEvent('compositionstart'))
  textarea.value = '한'
  textarea.dispatchEvent(new CompositionEvent('compositionupdate', { data: '한' }))
  // xterm settles the end position in a task of its own.
  await new Promise((resolve) => setTimeout(resolve, 5))

  // The IME path reports a real key code instead of the composition code 229.
  const keydown = new KeyboardEvent('keydown', { key: 'Process' })
  Object.defineProperty(keydown, 'keyCode', { value: 65 })
  textarea.dispatchEvent(keydown)

  textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '한' }))
  await new Promise((resolve) => setTimeout(resolve, 20))

  term.dispose()
  host.remove()
  return sent.filter((data) => data === '한')
}

describe('Hangul double commit', () => {
  it('xterm alone sends the syllable twice', async () => {
    expect(await compose(false)).toHaveLength(2)
  })

  it('the guard leaves exactly one', async () => {
    expect(await compose(true)).toHaveLength(1)
  })
})
