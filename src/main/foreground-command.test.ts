import { expect, test } from 'vitest'
import { commandFromCmdline, commandFromPsArgs, tpgidFromPs, tpgidFromStat } from './foreground-command'

test('tpgid is the sixth field after comm', () => {
  // pid 1234, comm "bash", then state ppid pgrp session tty_nr tpgid...
  expect(tpgidFromStat('1234 (bash) S 1 1234 1234 34816 5678 4194304')).toBe(5678)
})

test('parses from the last ) — comm may contain spaces and parens', () => {
  expect(tpgidFromStat('99 (tmux: client (v3)) S 1 99 99 34816 4321 0')).toBe(4321)
})

test('missing or non-positive tpgid is null', () => {
  expect(tpgidFromStat('1234 (bash) S 1 1234')).toBe(null)
  expect(tpgidFromStat('1234 (bash) S 1 1234 1234 34816 -1 0')).toBe(null)
  expect(tpgidFromStat('1234 (bash) S 1 1234 1234 34816 0 0')).toBe(null)
  expect(tpgidFromStat('broken')).toBe(null)
})

test('joins NUL-separated argv into one line', () => {
  expect(commandFromCmdline('npm\0run\0dev\0')).toBe('npm run dev')
})

test('quotes arguments with spaces', () => {
  expect(commandFromCmdline('vi\0my file.txt\0')).toBe("vi 'my file.txt'")
})

test('empty cmdline is null (kernel threads, races)', () => {
  expect(commandFromCmdline('')).toBe(null)
})

test('ps prints tpgid right-aligned, so the padding comes off', () => {
  expect(tpgidFromPs('  5678\n')).toBe(5678)
})

test('a tpgid ps could not answer is null — the caller compares it to the pid itself', () => {
  expect(tpgidFromPs('')).toBe(null)
  expect(tpgidFromPs('\n')).toBe(null)
  expect(tpgidFromPs('  -1\n')).toBe(null)
  expect(tpgidFromPs('  0\n')).toBe(null)
  expect(tpgidFromPs('?')).toBe(null)
})

test('ps args is already one line, so only the trailing newline goes', () => {
  expect(commandFromPsArgs('npm run dev\n')).toBe('npm run dev')
})

test('spaces inside the ps args line stay — argv boundaries are not recoverable', () => {
  expect(commandFromPsArgs('vi my file.txt\n')).toBe('vi my file.txt')
})

test('empty ps args is null (the process left between the two calls)', () => {
  expect(commandFromPsArgs('')).toBe(null)
  expect(commandFromPsArgs('   \n')).toBe(null)
})
