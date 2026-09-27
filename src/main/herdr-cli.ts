/**
 * The one place that runs the herdr binary.
 *
 * herdr answers as JSON: on stdout, or on stderr with exit 1 when it fails,
 * so a reply is judged by its `error` key. The dev server's shell may itself
 * sit inside herdr; its HERDR_* variables are dropped so every call targets
 * the session it names and nothing else.
 */
import { execFile } from 'node:child_process'
import { herdrError } from './herdr-command'

export type HerdrReply =
  | { readonly ok: true; readonly json: unknown }
  | { readonly ok: false; readonly code: string; readonly message: string }

/** One herdr call. `session` null runs the command without --session (list, stop). */
export type HerdrCli = (session: string | null, args: readonly string[]) => Promise<HerdrReply>

const CALL_TIMEOUT_MS = 5000

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('HERDR_')) delete env[key]
  return env
}

export const herdrCli: HerdrCli = (session, args) =>
  new Promise((resolve) => {
    const argv = session === null ? [...args] : ['--session', session, ...args]
    execFile('herdr', argv, { env: cleanEnv(), timeout: CALL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      let json: unknown = null
      try {
        json = JSON.parse(stdout.trim() === '' ? stderr : stdout)
      } catch {
        // Not JSON: a usage error, or no binary at all. Reported below.
      }
      const failure = herdrError(json)
      if (failure !== null) {
        resolve({ ok: false, ...failure })
        return
      }
      if (err !== null && json === null) {
        resolve({ ok: false, code: err.code === 'ENOENT' ? 'no_binary' : 'exec_failed', message: err.message })
        return
      }
      if (json === null) {
        resolve({ ok: false, code: 'not_json', message: stdout.trim().slice(0, 200) })
        return
      }
      resolve({ ok: true, json })
    })
  })

/** Whether the binary answers `--version`. */
export function herdrAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('herdr', ['--version'], { env: cleanEnv(), timeout: CALL_TIMEOUT_MS }, (err) => resolve(err === null))
  })
}
