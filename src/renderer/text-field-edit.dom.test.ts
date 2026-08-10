import { describe, expect, it } from 'vitest'
import { asTextField } from './text-field-edit'

const input = (type: string): HTMLInputElement => {
  const el = document.createElement('input')
  el.type = type
  return el
}

describe('asTextField', () => {
  it('takes the field types the chrome actually builds', () => {
    expect(asTextField(input('text'))).not.toBeNull()
    expect(asTextField(input('search'))).not.toBeNull()
    expect(asTextField(document.createElement('textarea'))).not.toBeNull()
  })

  it('leaves inputs without a caret alone', () => {
    // setSelectionRange throws on these, and there is no text to copy anyway.
    expect(asTextField(input('button'))).toBeNull()
    expect(asTextField(input('range'))).toBeNull()
    expect(asTextField(input('checkbox'))).toBeNull()
    expect(asTextField(input('email'))).toBeNull()
  })

  it('is null for the terminal, and for nothing focused', () => {
    expect(asTextField(document.createElement('div'))).toBeNull()
    expect(asTextField(null)).toBeNull()
  })
})
