import { describe, expect, it } from 'vitest'
import { parseFcListOutput } from './font-list'

const line = (family: string, spacing: string): string => `${family}\t${spacing}`

describe('parseFcListOutput', () => {
  it('accepts both mono (100) and dual (90)', () => {
    // Excluding dual would drop most fonts a CJK user would pick.
    const out = parseFcListOutput(
      [line('JetBrains Mono', '100'), line('Jetendard', '90')].join('\n'),
    )
    expect(out).toEqual(['JetBrains Mono', 'Jetendard'])
  })

  it('accepts charcell (110), which is stricter than mono', () => {
    expect(parseFcListOutput(line('Fixed', '110'))).toEqual(['Fixed'])
  })

  it('rejects proportional fonts', () => {
    // Blank spacing means proportional, which breaks the grid.
    expect(parseFcListOutput([line('Arial', ''), line('Pretendard', '0')].join('\n'))).toEqual([])
  })

  it('lists a family once across its weights', () => {
    const out = parseFcListOutput(
      [
        line('Jetendard', '90'),
        line('Jetendard', '90'),
        line('Jetendard', '90'),
      ].join('\n'),
    )
    expect(out).toEqual(['Jetendard'])
  })

  it('sorts by name', () => {
    const out = parseFcListOutput(
      [line('Noto Sans Mono', '100'), line('D2Coding', '90'), line('Hack', '100')].join('\n'),
    )
    expect(out).toEqual(['D2Coding', 'Hack', 'Noto Sans Mono'])
  })

  it('tolerates blank and nameless lines', () => {
    expect(parseFcListOutput(['', line('', '100'), line('Hack', '100'), ''].join('\n'))).toEqual([
      'Hack',
    ])
  })

  it('rejects non-numeric spacing', () => {
    expect(parseFcListOutput(line('Weird', 'mono'))).toEqual([])
  })
})
