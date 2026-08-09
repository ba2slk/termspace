/**
 * The bash hook, and where it lives.
 *
 * The file is ours, under our own config directory, and is rewritten on every
 * launch so an upgrade can change the hook without the user touching anything.
 * The user's ~/.bashrc is never edited — they add RC_LINE themselves, once, the
 * way starship and direnv ask. A program that rewrites someone's rc file is a
 * program that eventually corrupts it.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export function shellIntegrationFile(env: NodeJS.ProcessEnv): string {
  const base = env['XDG_CONFIG_HOME'] ?? join(env['HOME'] ?? '', '.config')
  return join(base, 'termspace', 'shell-integration.bash')
}

/** What the user pastes into ~/.bashrc. Kept on one line so it copies cleanly. */
export const RC_LINE =
  '[ -f ~/.config/termspace/shell-integration.bash ] && . ~/.config/termspace/shell-integration.bash'

/*
 * bash has no preexec, so this is a DEBUG trap — the mechanism bash-preexec
 * uses. `history 1` holds the line as submitted, before alias expansion, which
 * is the whole point: $BASH_COMMAND would show the expansion instead.
 */
export const HOOK_SCRIPT = `# Termspace shell integration (bash).
#
# Written by Termspace and overwritten on every launch — edit ~/.bashrc instead.
# Reports the line you submitted, before alias expansion, so "save this layout"
# records the alias you typed rather than what it expanded into.

case $- in
  *i*) ;;
  *) return 0 ;;
esac

[ -n "$BASH_VERSION" ] || return 0
[ "$TERM_PROGRAM" = "Termspace" ] || return 0
command -v base64 >/dev/null 2>&1 || return 0
# Leave an existing DEBUG trap alone; ours is worth less than whatever it does.
[ -z "$(trap -p DEBUG)" ] || return 0

# The trap fires for PROMPT_COMMAND's own commands as well as for submitted
# lines, and $HISTCMD is identical in both — gating on it reports the *previous*
# command, which on a fresh shell is the last line of the shared history file and
# so is the same in every pane. Instead PROMPT_COMMAND raises a flag and the
# first firing after it is the submitted line. This also collapses a compound
# alias, whose components each fire the trap.
__termspace_armed=0

__termspace_precmd() {
  __termspace_armed=1
}

# Appended, so it runs after whatever the rc already installed (starship, …) and
# the firings for those land while the flag is still down.
if [ "\${BASH_VERSINFO[0]}" -gt 5 ] 2>/dev/null ||
  { [ "\${BASH_VERSINFO[0]}" -eq 5 ] && [ "\${BASH_VERSINFO[1]}" -ge 1 ]; } 2>/dev/null &&
  [[ \${PROMPT_COMMAND@a} == *a* ]]; then
  PROMPT_COMMAND+=(__termspace_precmd)
else
  PROMPT_COMMAND="\${PROMPT_COMMAND:+\${PROMPT_COMMAND};}__termspace_precmd"
fi

__termspace_preexec() {
  local status=$?
  # Completion fires the trap as well, and submits nothing.
  [ -n "$COMP_LINE" ] && return $status
  [ "$__termspace_armed" = 1 ] || return $status
  __termspace_armed=0

  local entry line
  entry=$(HISTTIMEFORMAT= builtin history 1)
  [[ $entry =~ ^[[:space:]]*[0-9]+[[:space:]]+(.*)$ ]] || return $status
  line=\${BASH_REMATCH[1]}
  [ -n "$line" ] || return $status

  printf '\\033]1173;C;%s\\007' "$(printf '%s' "$line" | base64 | tr -d '\\n')" \\
    > /dev/tty 2>/dev/null
  return $status
}

trap '__termspace_preexec' DEBUG

printf '\\033]1173;A\\007' > /dev/tty 2>/dev/null
`

/** Best-effort: a pane still works without the hook, it just falls back to /proc. */
export async function writeShellIntegrationFile(env: NodeJS.ProcessEnv): Promise<void> {
  const path = shellIntegrationFile(env)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, HOOK_SCRIPT, 'utf8')
}
