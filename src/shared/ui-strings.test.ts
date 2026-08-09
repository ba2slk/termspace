import { describe, expect, it } from 'vitest'
import { STRINGS, stringsFor } from './ui-strings'

describe('stringsFor', () => {
  it('maps Korean locales to ko', () => {
    expect(stringsFor('ko')).toBe(STRINGS.ko)
    expect(stringsFor('ko-KR')).toBe(STRINGS.ko)
  })

  it('maps everything else to en', () => {
    expect(stringsFor('en-US')).toBe(STRINGS.en)
    expect(stringsFor('de')).toBe(STRINGS.en)
    expect(stringsFor('')).toBe(STRINGS.en)
  })
})

describe('catalogs', () => {
  const flatten = (value: unknown, prefix: string): string[] => {
    if (typeof value === 'string' || typeof value === 'function') return [prefix]
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      flatten(v, prefix === '' ? k : `${prefix}.${k}`),
    )
  }

  it('en and ko carry exactly the same keys', () => {
    expect(flatten(STRINGS.en, '').sort()).toEqual(flatten(STRINGS.ko, '').sort())
  })

  it('no entry is empty', () => {
    const values = (value: unknown): string[] => {
      if (typeof value === 'string') return [value]
      if (typeof value === 'function') return [String((value as (...a: string[]) => string)('x', 'y'))]
      return Object.values(value as Record<string, unknown>).flatMap(values)
    }
    for (const catalog of [STRINGS.en, STRINGS.ko]) {
      for (const v of values(catalog)) expect(v.trim()).not.toBe('')
    }
  })
})
