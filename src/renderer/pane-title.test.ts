import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PANE_TITLE,
  folderName,
  isDefaultPaneTitle,
  programName,
  stripName,
} from './pane-title'

const HOME = '/home/u'

describe('isDefaultPaneTitle', () => {
  it('is true for the default title and for nothing at all', () => {
    expect(isDefaultPaneTitle(DEFAULT_PANE_TITLE)).toBe(true)
    expect(isDefaultPaneTitle('  shell  ')).toBe(true)
    expect(isDefaultPaneTitle('')).toBe(true)
    expect(isDefaultPaneTitle('   ')).toBe(true)
  })

  it('is false for a title someone chose', () => {
    expect(isDefaultPaneTitle('server')).toBe(false)
    expect(isDefaultPaneTitle('shell two')).toBe(false)
  })
})

describe('programName', () => {
  it('keeps the first word and drops the arguments', () => {
    expect(programName('herdr session attach portfolio')).toBe('herdr')
    expect(programName('  htop  ')).toBe('htop')
  })

  it('strips the directory', () => {
    expect(programName('/usr/bin/nvim -p a b')).toBe('nvim')
    expect(programName('./scripts/x.sh')).toBe('x.sh')
  })

  it('skips environment assignments', () => {
    expect(programName('FOO=1 BAR=2 npm run dev')).toBe('npm')
    expect(programName('A_1=x\tcargo build')).toBe('cargo')
  })

  it('strips surrounding quotes', () => {
    expect(programName('"/opt/my app/bin/run" --x')).toBe('run')
    expect(programName("'vim' a")).toBe('vim')
  })

  it('is null when nothing is left', () => {
    expect(programName('')).toBeNull()
    expect(programName('   ')).toBeNull()
    expect(programName('FOO=1')).toBeNull()
    expect(programName('""')).toBeNull()
    expect(programName('dir/')).toBeNull()
  })
})

describe('folderName', () => {
  it('names a folder by its own name with a trailing slash', () => {
    expect(folderName('/home/u/dev/projects/termspace', HOME)).toBe('termspace/')
    expect(folderName('/tmp/', HOME)).toBe('tmp/')
  })

  it('calls home ~ and the root /', () => {
    expect(folderName(HOME, HOME)).toBe('~')
    expect(folderName(`${HOME}/`, HOME)).toBe('~')
    expect(folderName('/', HOME)).toBe('/')
  })

  it('resolves a ~-prefixed path', () => {
    expect(folderName('~', HOME)).toBe('~')
    expect(folderName('~/', HOME)).toBe('~')
    expect(folderName('~/x/y', HOME)).toBe('y/')
  })

  it('is null for nothing', () => {
    expect(folderName('', HOME)).toBeNull()
    expect(folderName('  ', HOME)).toBeNull()
  })

  it('does not call a folder home when home is unknown', () => {
    expect(folderName('/home/u', '')).toBe('u/')
  })
})

describe('stripName', () => {
  it('uses a title someone chose, trimmed', () => {
    expect(stripName('  api  ', 'node x', '/srv', HOME)).toBe('api')
  })

  it('falls back to the program a default-titled pane is running', () => {
    expect(stripName(DEFAULT_PANE_TITLE, '/usr/bin/nvim a', '/srv', HOME)).toBe('nvim')
    expect(stripName('', '  htop ', null, HOME)).toBe('htop')
  })

  it('names an idle shell by its folder', () => {
    expect(stripName(DEFAULT_PANE_TITLE, null, `${HOME}/dev/termspace`, HOME)).toBe('termspace/')
    expect(stripName(DEFAULT_PANE_TITLE, '   ', HOME, HOME)).toBe('~')
  })

  it('is null when there is neither a title, a program nor a folder', () => {
    expect(stripName(DEFAULT_PANE_TITLE, null, null, HOME)).toBeNull()
    expect(stripName(DEFAULT_PANE_TITLE, 'FOO=1', '', HOME)).toBeNull()
  })
})
