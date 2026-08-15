/**
 * pty lifecycle — one pty per paneId.
 *
 * node-pty is native, so it is required lazily to keep the bundler out of it.
 */
import { execFile } from 'node:child_process'
import { readFileSync, readlinkSync, statSync } from 'node:fs'
import { promisify } from 'node:util'
import type { PaneAttention, PtyExit, SpawnRequest, SpawnResult } from '../shared/protocol'
import {
  commandFromCmdline,
  commandFromPsArgs,
  tpgidFromPs,
  tpgidFromStat,
} from './foreground-command'
import { scanShellIntegration } from './shell-integration-osc'
import { NO_SIGNALS, scanTerminalSignals, type SignalState } from './terminal-signals'
import { APP_NAME } from '../shared/version'
import { version as APP_VERSION } from '../../package.json'

let ptyModule: typeof import('node-pty') | null = null

function pty(): typeof import('node-pty') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ptyModule ??= require('node-pty') as typeof import('node-pty')
  return ptyModule
}

/** Quiet period after first output that we treat as "prompt is ready". */
const PROMPT_SETTLE_MS = 80

/** node-pty needs string values, so drop the undefined entries in process.env. */
function ptyEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  env['TERM'] = 'xterm-256color'
  env['COLORTERM'] = 'truecolor'
  // What every emulator sets, so programs can tell where they are running.
  env['TERM_PROGRAM'] = APP_NAME
  env['TERM_PROGRAM_VERSION'] = APP_VERSION
  return env
}

const execFileAsync = promisify(execFile)

/** One `ps -o <field>= -p <pid>`, or null when the process is already gone. */
async function psField(field: string, pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', `${field}=`, '-p', String(pid)])
    return stdout
  } catch {
    return null
  }
}

/**
 * The /proc answer, for a platform without /proc: darwin. Same two facts and
 * the same meaning — tpgid equal to the shell's own pid means nothing is
 * running. Works on Linux too, which is what lets a test drive it there.
 */
export async function foregroundCommandViaPs(pid: number): Promise<string | null> {
  const tpgidText = await psField('tpgid', pid)
  if (tpgidText === null) return null
  const tpgid = tpgidFromPs(tpgidText)
  if (tpgid === null || tpgid === pid) return null
  const args = await psField('args', tpgid)
  return args === null ? null : commandFromPsArgs(args)
}

export interface PtyHandlers {
  readonly onData: (paneId: string, data: string) => void
  readonly onExit: (exit: PtyExit) => void
  /** A bell or a notification the program asked for. Title and cwd are held, not pushed. */
  readonly onAttention: (attention: PaneAttention) => void
}

export interface PtyHost {
  spawn(request: SpawnRequest, handlers: PtyHandlers): SpawnResult
  write(paneId: string, data: string): void
  resize(paneId: string, cols: number, rows: number): void
  kill(paneId: string): void
  pause(paneId: string): void
  resume(paneId: string): void
  killAll(): void
  has(paneId: string): boolean
  /** Where this pane's shell currently stands, or null. Used when saving a layout. */
  cwdOf(paneId: string): string | null
  /** The command running in this pane's foreground, or null when idle. */
  foregroundCommandOf(paneId: string): Promise<string | null>
  /** The window title the program last asked for (OSC 0/2), or null. */
  titleOf(paneId: string): string | null
  /**
   * The last line this pane's shell reported submitting, before alias expansion.
   * Null unless the user has installed the shell hook.
   */
  submittedCommandOf(paneId: string): string | null
  /** Whether the shell hook has announced itself in any live pane. */
  hasIntegratedPane(): boolean
}

interface Entry {
  readonly process: import('node-pty').IPty
  promptTimer: NodeJS.Timeout | null
  /** Startup input not yet sent to the shell. */
  pendingCommand: string | null
  /** When true, send without a newline so the user presses Enter. */
  pendingIsPrefill: boolean
  /** The last line the shell reported submitting, if the hook is installed. */
  submittedCommand: string | null
  /** Set once the hook announces itself, so settings can show whether it is live. */
  integrated: boolean
  /** An OSC sequence split across two reads. */
  oscCarry: string
  /** Carry for the standard sequences, which are watched rather than stripped. */
  signalState: SignalState
  /** Last OSC 0/2 title, or null when the program never set one. */
  title: string | null
  /** Last OSC 7 path. Preferred over /proc, which cannot see through a shell's own cd. */
  reportedCwd: string | null
}

export function createPtyHost(): PtyHost {
  // Load once here so a native-module failure surfaces with a clear origin.
  pty()

  const entries = new Map<string, Entry>()

  function sendPendingCommand(paneId: string): void {
    const entry = entries.get(paneId)
    if (entry === undefined || entry.pendingCommand === null) return
    // Sent as shell input rather than exec'd, so the shell survives the program.
    entry.process.write(entry.pendingIsPrefill ? entry.pendingCommand : `${entry.pendingCommand}\n`)
    entry.pendingCommand = null
  }

  const host: PtyHost = {
    spawn(request, handlers) {
      if (entries.has(request.paneId)) {
        return { ok: false, message: `Pane already exists: ${request.paneId}` }
      }

      try {
        const stats = statSync(request.cwd)
        if (!stats.isDirectory()) {
          return { ok: false, message: `Not a directory: ${request.cwd}` }
        }
      } catch {
        return { ok: false, message: `Directory does not exist: ${request.cwd}` }
      }

      let child: import('node-pty').IPty
      try {
        child = pty().spawn(request.shell, [], {
          name: 'xterm-256color',
          cols: Math.max(1, request.cols),
          rows: Math.max(1, request.rows),
          cwd: request.cwd,
          env: ptyEnv(),
        })
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        return { ok: false, message: `Failed to spawn shell (${request.shell}): ${detail}` }
      }

      const entry: Entry = {
        process: child,
        promptTimer: null,
        // command runs; prefill is typed but left for the user to submit.
        pendingCommand: request.command ?? request.prefill,
        pendingIsPrefill: request.command === null && request.prefill !== null,
        submittedCommand: null,
        integrated: false,
        oscCarry: '',
        signalState: NO_SIGNALS,
        title: null,
        reportedCwd: null,
      }
      entries.set(request.paneId, entry)

      child.onData((raw) => {
        // Our own sequences never reach the terminal.
        const scan = scanShellIntegration(entry.oscCarry, raw)
        entry.oscCarry = scan.carry
        for (const event of scan.events) {
          if (event.kind === 'sourced') entry.integrated = true
          else entry.submittedCommand = event.command
        }
        if (scan.output !== '') {
          // Watched, never consumed: these sequences belong to the terminal and
          // xterm has to see them exactly as the program wrote them.
          const seen = scanTerminalSignals(entry.signalState, scan.output)
          entry.signalState = seen.state
          for (const signal of seen.signals) {
            if (signal.kind === 'title') entry.title = signal.title
            else if (signal.kind === 'cwd') entry.reportedCwd = signal.path
            else if (signal.kind === 'bell') {
              handlers.onAttention({ paneId: request.paneId, kind: 'bell', title: '', body: '' })
            } else {
              handlers.onAttention({
                paneId: request.paneId,
                kind: 'notify',
                title: signal.title,
                body: signal.body,
              })
            }
          }
          handlers.onData(request.paneId, scan.output)
        }
        if (entry.pendingCommand === null) return
        // The hook's own OSC is the first thing a pty says, and it says it while the
        // rc file is still running. Arming on invisible output sends the command
        // before the shell reads input, so the tty echoes it above the prompt.
        if (scan.output === '') return
        // Reset on every chunk — the quiet moment is when the prompt is done.
        if (entry.promptTimer !== null) clearTimeout(entry.promptTimer)
        entry.promptTimer = setTimeout(() => sendPendingCommand(request.paneId), PROMPT_SETTLE_MS)
      })

      child.onExit(({ exitCode, signal }) => {
        const dying = entries.get(request.paneId)
        if (dying?.promptTimer != null) clearTimeout(dying.promptTimer)
        entries.delete(request.paneId)
        handlers.onExit({ paneId: request.paneId, exitCode, signal: signal ?? null })
      })

      return { ok: true, message: null }
    },

    write(paneId, data) {
      entries.get(paneId)?.process.write(data)
    },

    resize(paneId, cols, rows) {
      const entry = entries.get(paneId)
      if (entry === undefined) return
      try {
        entry.process.resize(Math.max(1, cols), Math.max(1, rows))
      } catch {
        // resize can race a just-exited pty
      }
    },

    kill(paneId) {
      const entry = entries.get(paneId)
      if (entry === undefined) return
      if (entry.promptTimer !== null) clearTimeout(entry.promptTimer)
      entry.process.kill()
      // Removed in onExit; deleting here would drop the exit notification.
    },

    pause(paneId) {
      entries.get(paneId)?.process.pause()
    },

    resume(paneId) {
      entries.get(paneId)?.process.resume()
    },

    killAll() {
      for (const paneId of [...entries.keys()]) host.kill(paneId)
    },

    has(paneId) {
      return entries.has(paneId)
    },

    cwdOf(paneId) {
      const entry = entries.get(paneId)
      if (entry === undefined) return null
      // What the shell itself reported beats what the OS can infer, and it is
      // the same answer on every platform. /proc is the fallback for shells
      // with no hook — and the only path that exists before the first prompt.
      if (entry.reportedCwd !== null) return entry.reportedCwd
      // Linux only. The link disappears once the shell exits, so failure is normal.
      try {
        return readlinkSync(`/proc/${String(entry.process.pid)}/cwd`)
      } catch {
        return null
      }
    },

    async foregroundCommandOf(paneId) {
      const entry = entries.get(paneId)
      if (entry === undefined) return null
      const pid = entry.process.pid
      // ps costs a subprocess, so it stays on the platform that has no /proc.
      if (process.platform === 'darwin') return foregroundCommandViaPs(pid)
      // Races with exiting processes are normal — null then.
      try {
        const tpgid = tpgidFromStat(readFileSync(`/proc/${String(pid)}/stat`, 'utf8'))
        if (tpgid === null || tpgid === pid) return null
        return commandFromCmdline(readFileSync(`/proc/${String(tpgid)}/cmdline`, 'utf8'))
      } catch {
        return null
      }
    },

    titleOf(paneId) {
      return entries.get(paneId)?.title ?? null
    },

    submittedCommandOf(paneId) {
      return entries.get(paneId)?.submittedCommand ?? null
    },

    hasIntegratedPane() {
      for (const entry of entries.values()) {
        if (entry.integrated) return true
      }
      return false
    },
  }

  return host
}
