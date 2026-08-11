/**
 * What is running in a pane's shell right now, read when saving.
 *
 * Pure parsing only — the reads live in pty-host. The foreground job is the
 * process group the terminal is handing keys to (tpgid); when that is the
 * shell itself, nothing is running. Two sources say the same two things:
 * /proc on Linux, `ps` on darwin, which has no /proc.
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

/** tpgid from `ps -o tpgid= -p <pid>`, which right-aligns the number. */
export function tpgidFromPs(text: string): number | null {
  const tpgid = Number(text.trim())
  // An empty answer is Number('') === 0, which this rejects along with -1.
  return Number.isInteger(tpgid) && tpgid > 0 ? tpgid : null
}

/**
 * argv from `ps -o args= -p <pid>`, which has already joined it with spaces.
 * The boundaries are gone, so quoting per argument is not possible here — the
 * line goes out as ps drew it. Same filtering as the cmdline side otherwise:
 * nothing to say means null, and the argv is not otherwise touched.
 */
export function commandFromPsArgs(args: string): string | null {
  const command = args.trim()
  return command === '' ? null : command
}
