/**
 * Monospace-ish fonts installed on this machine, via fontconfig (`fc-list`).
 *
 * The settings screen offers these instead of free text so a typo can't
 * silently swap the terminal font. An empty list is not an error.
 */
import { execFile } from 'node:child_process'

/**
 * Minimum fontconfig spacing to accept: 0 proportional, 90 dual, 100 mono,
 * 110 charcell.
 *
 * Dual must be included. CJK fonts built on a monospace Latin face report
 * dual, so requiring 100 drops most fonts a Korean user would pick.
 */
const MIN_SPACING = 90

/** Family and spacing, tab separated — everything needed in one call. */
const FORMAT = '%{family[0]}\\t%{spacing}\\n'

/**
 * Restrict to fonts that claim Latin coverage.
 *
 * Icon and emoji fonts have uniform glyph widths, so fontconfig reports them
 * as monospace; this filter is what keeps them out of the list.
 */
const PATTERN = ':lang=en'

/** Pick usable families out of `family\tspacing` lines. Blank spacing means proportional. */
export function parseFcListOutput(stdout: string): string[] {
  const names = new Set<string>()
  for (const line of stdout.split('\n')) {
    const [family, spacing] = line.split('\t')
    const name = family?.trim()
    if (name === undefined || name === '') continue
    const value = Number(spacing?.trim())
    if (!Number.isFinite(value) || value < MIN_SPACING) continue
    names.add(name)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

export async function listMonoFonts(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'fc-list',
      [PATTERN, '-f', FORMAT],
      { timeout: 3000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        // A missing or failing fc-list must not break the app.
        resolve(error === null ? parseFcListOutput(stdout) : [])
      },
    )
  })
}
