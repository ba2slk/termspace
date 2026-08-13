/**
 * Locates session YAML and hands it to session-schema. Knows where files are,
 * not what makes them valid.
 */
import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parse as parseYaml, parseDocument } from 'yaml'
import type { LoadSessionResult, SaveSessionResult, SessionSummary } from '../shared/protocol'
import { configDir } from './config-dir'
import { applyOrder, renameInOrder } from './session-order'
import { readOrder, writeOrder } from './session-order-file'
import { parseSession, resolveCwd } from './session-schema'
import {
  deriveSessionId,
  isValidSessionId,
  SESSION_HEADER,
  toSessionYaml,
  type SessionDraft,
} from './session-writer'

export function sessionsDir(env: NodeJS.ProcessEnv): string {
  return join(configDir(env), 'sessions')
}

/*
 * The example carries the same header as a saved session and uses every field
 * once, so reading one file is enough to write your own.
 */
export const EXAMPLE_SESSION = `${SESSION_HEADER}
name: example

# An unquoted ~ is null in YAML, so keep the quotes.
cwd: "~"

columns:
  - width: 720
    panes:
      - title: shell
      - title: log
        command: journalctl -f -n 20
        height: 0.35

  - width: 640
    panes:
      - title: notes
        cwd: dev              # relative to the cwd above
        prefill: ls -la
`

async function summarize(dir: string, file: string): Promise<SessionSummary> {
  const path = join(dir, file)
  const id = basename(file).replace(/\.ya?ml$/, '')

  // birthtime is 0 on filesystems that do not record one; the last write is the
  // closest honest stand-in.
  let createdMs = 0
  try {
    const info = await stat(path)
    createdMs = info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs
  } catch {
    // Vanished between readdir and here — createdMs stays 0, so it sorts first
    // this pass, then drops out on the next listing.
  }

  let raw: unknown
  try {
    raw = parseYaml(await readFile(path, 'utf8'))
  } catch (err) {
    const detail = err instanceof Error ? err.message.split('\n')[0] : String(err)
    return { id, name: id, file: path, paneCount: 0, createdMs, error: `YAML syntax error: ${detail}` }
  }

  // The list only needs a name and pane count, so skip path resolution.
  const parsed = parseSession(raw, { home: '', shell: null })
  if (!parsed.ok) {
    const first = parsed.issues[0]
    return {
      id,
      name: id,
      file: path,
      paneCount: 0,
      createdMs,
      error:
        first === undefined
          ? 'Could not read the configuration'
          : `${first.path || 'top level'}: ${first.message}`,
    }
  }

  return {
    id,
    name: parsed.spec.name,
    file: path,
    paneCount: parsed.spec.columns.reduce((a, c) => a + c.panes.length, 0),
    createdMs,
    error: null,
  }
}

/** orderPath is the app's order file; the listing follows it and keeps it true. */
export async function listSessions(dir: string, orderPath: string): Promise<SessionSummary[]> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
  } catch {
    return [] // No directory yet — first run
  }

  const summaries = await Promise.all(files.map((f) => summarize(dir, f)))
  const order = await readOrder(orderPath)
  const listed = applyOrder(summaries, order)

  // Seeds the file on a first run and prunes deleted sessions on every later one.
  const resolved = listed.map((s) => s.id)
  if (resolved.length !== order.length || resolved.some((id, i) => order[i] !== id)) {
    await writeOrder(orderPath, resolved)
  }
  return listed
}

/** id is the file name without extension, not the display name. */
export async function loadSession(
  dir: string,
  id: string,
  env: NodeJS.ProcessEnv,
): Promise<LoadSessionResult> {
  // Comes from the renderer; separators would escape the sessions directory.
  if (id.includes('/') || id.includes('\\') || id.includes('\0')) {
    return {
      ok: false,
      spec: null,
      file: '',
      issues: [{ path: '', message: 'Invalid session name' }],
    }
  }

  // The listing accepts both extensions, so opening must too.
  let file = join(dir, `${id}.yaml`)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    file = join(dir, `${id}.yml`)
    try {
      text = await readFile(file, 'utf8')
    } catch {
      return {
        ok: false,
        spec: null,
        file: join(dir, `${id}.yaml`),
        issues: [{ path: '', message: `Session file not found: ${join(dir, `${id}.yaml`)}` }],
      }
    }
  }

  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (err) {
    const detail = err instanceof Error ? err.message.split('\n')[0] : String(err)
    return { ok: false, spec: null, file, issues: [{ path: '', message: `YAML syntax error: ${detail}` }] }
  }

  const parsed = parseSession(raw, { home: env['HOME'] ?? '/', shell: env['SHELL'] ?? null })
  return parsed.ok
    ? { ok: true, spec: parsed.spec, file, issues: [] }
    : { ok: false, spec: null, file, issues: parsed.issues }
}

/** Does this id already exist? Checks both .yaml and .yml. */
export async function sessionExists(dir: string, id: string): Promise<boolean> {
  if (!isValidSessionId(id)) return false
  for (const ext of ['yaml', 'yml']) {
    try {
      await stat(join(dir, `${id}.${ext}`))
      return true
    } catch {
      // Missing — try the other extension
    }
  }
  return false
}

/** Write the layout to a session file. Overwriting must be requested explicitly. */
export async function saveSession(
  dir: string,
  id: string,
  draft: SessionDraft,
  overwrite: boolean,
  home: string,
): Promise<SaveSessionResult> {
  if (!isValidSessionId(id)) {
    return {
      ok: false,
      file: '',
      error: 'Names may only use letters, digits, dots, underscores and hyphens',
    }
  }

  const path = join(dir, `${id}.yaml`)
  if (!overwrite && (await sessionExists(dir, id))) {
    return { ok: false, file: path, error: 'A session with this name already exists' }
  }

  try {
    await mkdir(dir, { recursive: true })
    /*
     * Keep the previous file. A save reads live state, and once a bad reading
     * lands there is nothing left to compare against — a hand-written session
     * can be lost to one click. One generation is enough to undo that.
     */
    if (overwrite) {
      try {
        await copyFile(path, `${path}.bak`)
      } catch {
        // Nothing to keep on the first save of a name.
      }
    }
    await writeFile(path, toSessionYaml(draft, home), 'utf8')
    return { ok: true, file: path, error: null }
  } catch (err) {
    return { ok: false, file: path, error: err instanceof Error ? err.message : String(err) }
  }
}

/** A blank session with one pane. */
export async function createBlankSession(
  dir: string,
  id: string,
  displayName: string,
  width: number,
  home: string,
  rootCwd: string,
): Promise<SaveSessionResult> {
  const cwd = resolveCwd(home, rootCwd.trim() === '' ? '~' : rootCwd.trim(), home)
  const draft: SessionDraft = {
    name: displayName,
    cwd,
    columns: [
      { width, panes: [{ title: 'shell', command: null, prefill: null, cwd, heightRatio: 1 }] },
    ],
  }
  // Never overwrite — creating a blank session must not destroy another.
  return saveSession(dir, id, draft, false, home)
}

/** Resolve the file to delete. The caller moves it to the trash. */
export async function sessionFilePath(dir: string, id: string): Promise<string | null> {
  if (!isValidSessionId(id)) return null
  for (const ext of ['yaml', 'yml']) {
    const path = join(dir, `${id}.${ext}`)
    try {
      await stat(path)
      return path
    } catch {
      // Missing — try the other extension
    }
  }
  return null
}

/**
 * Rewrite the `name:` field, and take the file name with it. A targeted
 * document edit rather than a parse-and-reserialize: hand-written comments and
 * any panes the schema would reject must survive a rename untouched.
 */
export async function renameSessionName(
  dir: string,
  id: string,
  newName: string,
  orderPath: string,
): Promise<SaveSessionResult> {
  const name = newName.trim()
  if (name === '') return { ok: false, file: '', error: 'Name must not be empty' }
  const path = await sessionFilePath(dir, id)
  if (path === null) return { ok: false, file: '', error: `Session file not found: ${id}` }
  try {
    const before = await readFile(path, 'utf8')
    const doc = parseDocument(before)
    if (doc.errors.length > 0) {
      return { ok: false, file: path, error: 'YAML syntax error — fix the file first' }
    }
    doc.set('name', name)
    const text = doc.toString()

    // A name of punctuation alone derives nothing; the file keeps the id it has.
    const newId = deriveSessionId(name)
    if (newId === '' || newId === id) {
      // Same one-generation undo as every other write to a session file.
      await copyFile(path, `${path}.bak`)
      await writeFile(path, text, 'utf8')
      return { ok: true, file: path, error: null }
    }

    if (await sessionExists(dir, newId)) {
      return { ok: false, file: path, error: 'A session with this name already exists' }
    }

    const moved = join(dir, `${newId}.yaml`)
    // The new file's one generation back is the file as it stood before the rename.
    await writeFile(`${moved}.bak`, before, 'utf8')
    await writeFile(moved, text, 'utf8')
    await unlink(path)
    // The file moved, so the id did; the position must not follow it.
    await writeOrder(orderPath, renameInOrder(await readOrder(orderPath), id, newId))
    return { ok: true, file: moved, error: null }
  } catch (err) {
    return { ok: false, file: path, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function createExampleSession(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'example.yaml')
  // wx fails if the file exists, so a customised example survives.
  try {
    await writeFile(path, EXAMPLE_SESSION, { encoding: 'utf8', flag: 'wx' })
  } catch {
    // Already there — leave it
  }
  return path
}
