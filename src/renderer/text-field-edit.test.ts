import { describe, expect, it } from 'vitest'
import { selectedText, withPasted } from './text-field-edit'

describe('selectedText', () => {
  it('takes the selected slice', () => {
    expect(selectedText('hello world', 6, 11)).toBe('world')
  })

  it('is empty for a caret with no selection', () => {
    expect(selectedText('hello', 3, 3)).toBe('')
  })

  it('reads a backwards selection the same way', () => {
    expect(selectedText('hello world', 11, 6)).toBe('world')
  })
})

describe('withPasted', () => {
  it('inserts at the caret', () => {
    expect(withPasted('ac', 1, 1, 'b')).toEqual({ value: 'abc', caret: 2 })
  })

  it('replaces the selection and leaves the caret after the text', () => {
    expect(withPasted('hello world', 6, 11, 'there')).toEqual({
      value: 'hello there',
      caret: 11,
    })
  })

  it('handles a backwards selection', () => {
    expect(withPasted('hello world', 11, 6, 'you')).toEqual({
      value: 'hello you',
      caret: 9,
    })
  })
})
