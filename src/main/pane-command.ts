/**
 * Which command a pane is saved with.
 *
 * Three sources disagree, and they are ranked by how close each sits to what the
 * user meant: the YAML says what the pane is for, the shell says what was typed,
 * /proc says what the kernel ended up running. /proc is last because it cannot
 * see an alias — by the time a process exists the alias has already been
 * substituted away.
 */
import { resolveCwd } from './session-schema'
import type { HerdrInside } from './herdr-attach'
import { herdrSessionFromCommand } from './herdr-command'

export interface PaneCommandInputs {
  /** Set in the YAML: a decision to type a command but not run it. */
  readonly prefill: string | null
  /** The command the pane was opened with. */
  readonly declaredCommand: string | null
  /** The last line the shell reported submitting, before alias expansion. */
  readonly submittedCommand: string | null
  /** What /proc shows in the foreground, or null when the shell sits idle. */
  readonly foregroundCommand: string | null
  /** The path the pane was spawned in, as written: absolute or `~`-relative. */
  readonly declaredCwd: string
  /** Where the shell sits now, or null when the pty is gone. */
  readonly liveCwd: string | null
  /** $HOME, so a `~` declaration and an absolute live path compare equal. */
  readonly home: string
}

/** Unknown counts as unmoved: a dead pty is no evidence the user went anywhere. */
function movedAway({ declaredCwd, liveCwd, home }: PaneCommandInputs): boolean {
  if (liveCwd === null) return false
  return resolveCwd(home, declaredCwd, home) !== resolveCwd(home, liveCwd, home)
}

export function resolvePaneCommand(inputs: PaneCommandInputs): string | null {
  const { prefill, declaredCommand, submittedCommand, foregroundCommand } = inputs
  // Capturing over a prefill would betray the decision not to run it.
  if (prefill !== null) return declaredCommand
  if (foregroundCommand === null) {
    // An idle shell keeps its old command — the pane's purpose survives. Unless
    // it was cd-ed away: the command belongs to where it ran, and saving it
    // against the new cwd would write a pairing that never existed.
    return movedAway(inputs) ? null : declaredCommand
  }
  return submittedCommand ?? foregroundCommand
}

export interface SavedPaneInputs extends PaneCommandInputs {
  /** Set in the YAML: the herdr session this pane was opened as. */
  readonly declaredHerdr: string | null
  /**
   * What runs inside the herdr session the pane is attached to; null when the
   * pane is not attached, or the server does not answer.
   */
  readonly inside: HerdrInside | null
}

/** The herdr session a pane is attached to right now, from its shell line. */
export function attachedHerdr(inputs: PaneCommandInputs): string | null {
  const line = inputs.submittedCommand ?? inputs.foregroundCommand
  return line === null ? null : herdrSessionFromCommand(line)
}

export function resolveSavedPane(inputs: SavedPaneInputs): { readonly command: string | null; readonly herdr: string | null } {
  if (inputs.prefill !== null) return { command: inputs.declaredCommand, herdr: inputs.declaredHerdr }
  const name = attachedHerdr(inputs)
  if (name === null) {
    const command = resolvePaneCommand(inputs)
    // The idle rule covers herdr too: detached or stopped, the pane still is that session.
    const idle = inputs.foregroundCommand === null
    return { command, herdr: idle && !movedAway(inputs) ? inputs.declaredHerdr : null }
  }
  const { inside } = inputs
  // No answer, no pane yet, or several: nothing single to read. The declaration is
  // the user's intent and restore leaves a many-pane session alone, so keep it.
  if (inside === null || inside.panes !== 1) return { command: inputs.declaredCommand, herdr: name }
  return { command: inside.foreground ?? inputs.declaredCommand, herdr: name }
}
