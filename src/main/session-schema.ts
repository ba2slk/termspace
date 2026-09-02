/**
 * Validate and normalise parsed YAML into a SessionSpec. Pure; no filesystem.
 *
 * Errors are data, not exceptions: a bad pane becomes an ErrorSpec that keeps
 * its slot while the rest of the session still runs.
 */
import { z } from 'zod'
import type {
  ColumnSpec,
  ConfigIssue,
  PaneSpec,
  SessionSpec,
} from '../shared/protocol'

export type { ColumnSpec, ConfigIssue, ErrorSpec, PaneEntry, PaneSpec, SessionSpec } from '../shared/protocol'


export type ParseResult =
  | { readonly ok: true; readonly spec: SessionSpec }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] }

export interface ParseEnv {
  readonly home: string
  /** $SHELL, or null. */
  readonly shell: string | null
}

const DEFAULT_COLUMN_WIDTH = 640
const FALLBACK_SHELL = '/bin/sh'

const sessionShape = z.strictObject({
  name: z.string().min(1),
  cwd: z.string().min(1).optional(),
  shell: z.string().min(1).optional(),
  columns: z.array(z.unknown()).min(1),
})

const columnShape = z.strictObject({
  width: z.number().positive().optional(),
  panes: z.array(z.unknown()).min(1),
})

const paneShape = z.strictObject({
  title: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  prefill: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  height: z.number().gt(0).lt(1).optional(),
  minimized: z.boolean().optional(),
})

// ── Paths ─────────────────────────────────────────────────────────

function normalizePosix(path: string): string {
  const absolute = path.startsWith('/')
  const parts: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else if (!absolute) parts.push('..')
    } else {
      parts.push(segment)
    }
  }
  const joined = (absolute ? '/' : '') + parts.join('/')
  return joined === '' ? (absolute ? '/' : '.') : joined
}

/** Expand `~` and resolve relatives. POSIX only. */
export function resolveCwd(base: string, value: string, home: string): string {
  const expanded = value === '~' ? home : value.startsWith('~/') ? home + value.slice(1) : value
  return normalizePosix(expanded.startsWith('/') ? expanded : `${base}/${expanded}`)
}

// ── Messages ──────────────────────────────────────────────────────

interface RawIssue {
  readonly code: string
  readonly path: readonly PropertyKey[]
  readonly message: string
  readonly keys?: readonly string[]
  readonly expected?: string
  readonly minimum?: number
  readonly maximum?: number
}

function renderPath(prefix: string, path: readonly PropertyKey[]): string {
  let out = prefix
  for (const key of path) {
    out += typeof key === 'number' ? `[${key}]` : out === '' ? String(key) : `.${String(key)}`
  }
  return out
}

/** zod messages are shown to the user, so rewrite them in plain words. */
function describeIssue(issue: RawIssue): string {
  switch (issue.code) {
    case 'unrecognized_keys':
      return `unknown key: ${(issue.keys ?? []).join(', ')}`
    case 'invalid_type':
      return `must be a ${issue.expected ?? 'different type'}`
    case 'too_small':
      return issue.minimum === 1 ? 'must not be empty' : `must be greater than ${issue.minimum}`
    case 'too_big':
      return `must be less than ${issue.maximum}`
    default:
      return issue.message
  }
}

function toIssues(prefix: string, error: z.ZodError): ConfigIssue[] {
  return (error.issues as unknown as RawIssue[]).map((issue) => ({
    path: renderPath(prefix, issue.path),
    message: describeIssue(issue),
  }))
}

// ── Height distribution ───────────────────────────────────────────

/**
 * Explicit heights are honoured first; the rest split what remains evenly.
 * An explicit total of 1 or more leaves nothing to share, so it is an error.
 */
function distributeHeights(given: readonly (number | null)[]): number[] | null {
  const explicit = given.filter((h): h is number => h !== null)
  const unspecified = given.length - explicit.length
  const sum = explicit.reduce((a, b) => a + b, 0)

  if (unspecified === 0) {
    if (sum <= 0) return given.map(() => 1 / given.length)
    return given.map((h) => h! / sum) // All explicit: normalise, keeping the ratio
  }
  if (sum >= 1) return null

  const each = (1 - sum) / unspecified
  return given.map((h) => h ?? each)
}

// ── Parsing ───────────────────────────────────────────────────────

function parsePane(
  raw: unknown,
  path: string,
  sessionCwd: string,
  home: string,
): { pane: Omit<PaneSpec, 'heightRatio'>; height: number | null } | ConfigIssue {
  const parsed = paneShape.safeParse(raw)
  if (!parsed.success) return toIssues(path, parsed.error)[0]!

  const { title, command, prefill, cwd, height, minimized } = parsed.data
  return {
    pane: {
      kind: 'pane',
      title: title ?? command?.trim().split(/\s+/)[0] ?? 'shell',
      command: command ?? null,
      prefill: prefill ?? null,
      cwd: cwd === undefined ? sessionCwd : resolveCwd(sessionCwd, cwd, home),
      minimized: minimized ?? false,
    },
    height: height ?? null,
  }
}

function parseColumn(raw: unknown, path: string, sessionCwd: string, home: string): ColumnSpec {
  const errorColumn = (issue: ConfigIssue): ColumnSpec => ({
    width: DEFAULT_COLUMN_WIDTH,
    panes: [{ kind: 'error', issue, heightRatio: 1 }],
  })

  const parsed = columnShape.safeParse(raw)
  if (!parsed.success) return errorColumn(toIssues(path, parsed.error)[0]!)

  const results = parsed.data.panes.map((pane, i) =>
    parsePane(pane, `${path}.panes[${i}]`, sessionCwd, home),
  )
  const heights = results.map((r) => ('pane' in r ? r.height : null))
  const ratios = distributeHeights(heights)

  if (ratios === null) {
    return errorColumn({
      path: `${path}.panes`,
      message:
        'explicit heights sum to 1 or more, leaving no room for the remaining panes',
    })
  }

  return {
    width: parsed.data.width ?? DEFAULT_COLUMN_WIDTH,
    panes: results.map((r, i) =>
      'pane' in r
        ? { ...r.pane, heightRatio: ratios[i]! }
        : { kind: 'error' as const, issue: r, heightRatio: ratios[i]! },
    ),
  }
}

export function parseSession(raw: unknown, env: ParseEnv): ParseResult {
  const parsed = sessionShape.safeParse(raw)
  if (!parsed.success) return { ok: false, issues: toIssues('', parsed.error) }

  const { name, cwd, shell, columns } = parsed.data
  const sessionCwd = cwd === undefined ? env.home : resolveCwd(env.home, cwd, env.home)

  return {
    ok: true,
    spec: {
      name,
      cwd: sessionCwd,
      shell: shell ?? env.shell ?? FALLBACK_SHELL,
      columns: columns.map((column, i) =>
        parseColumn(column, `columns[${i}]`, sessionCwd, env.home),
      ),
    },
  }
}
