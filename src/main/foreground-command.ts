/**
 * What is running in a pane's shell right now, read from /proc when saving.
 *
 * Pure parsing only — the /proc reads live in pty-host. The foreground job is
 * the process group the terminal is handing keys to (tpgid); when that is the
 * shell itself, nothing is running.
 */
import { shellQuote } from '../shared/shell-quote'

/** tpgid from /proc/<pid>/stat. comm may contain spaces and ')', so parse after the last ')'. */
export function tpgidFromStat(stat: string): number | null {
  const close = stat.lastIndexOf(')')
  if (close === -1) return null
  const fields = stat.slice(close + 2).split(' ')
  // After comm: state ppid pgrp session tty_nr tpgid ...
  const tpgid = Number(fields[5])
  return Number.isInteger(tpgid) && tpgid > 0 ? tpgid : null
}

/** argv from /proc/<pid>/cmdline (NUL-separated) as one shell-safe line. */
export function commandFromCmdline(cmdline: string): string | null {
  const argv = cmdline.split('\0').filter((arg) => arg !== '')
  if (argv.length === 0) return null
  return argv.map(shellQuote).join(' ')
}
