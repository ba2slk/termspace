/**
 * Which command a pane is saved with.
 *
 * Three sources disagree, and they are ranked by how close each sits to what the
 * user meant: the YAML says what the pane is for, the shell says what was typed,
 * /proc says what the kernel ended up running. /proc is last because it cannot
 * see an alias — by the time a process exists the alias has already been
 * substituted away.
 */
export interface PaneCommandInputs {
  /** Set in the YAML: a decision to type a command but not run it. */
  readonly prefill: string | null
  /** The command the pane was opened with. */
  readonly declaredCommand: string | null
  /** The last line the shell reported submitting, before alias expansion. */
  readonly submittedCommand: string | null
  /** What /proc shows in the foreground, or null when the shell sits idle. */
  readonly foregroundCommand: string | null
}

export function resolvePaneCommand(inputs: PaneCommandInputs): string | null {
  const { prefill, declaredCommand, submittedCommand, foregroundCommand } = inputs
  // Capturing over a prefill would betray the decision not to run it.
  if (prefill !== null) return declaredCommand
  // An idle shell keeps its old command — the pane's purpose survives.
  if (foregroundCommand === null) return declaredCommand
  return submittedCommand ?? foregroundCommand
}
