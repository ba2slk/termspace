/**
 * The bash and zsh hooks, and where they live.
 *
 * The file is ours, under our own config directory, and is rewritten on every
 * launch so an upgrade can change the hook without the user touching anything.
 * The user's ~/.bashrc is never edited — they add RC_LINE themselves, once, the
 * way starship and direnv ask. A program that rewrites someone's rc file is a
 * program that eventually corrupts it.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { configDir } from './config-dir'

export function shellIntegrationFile(env: NodeJS.ProcessEnv): string {
  return join(configDir(env), 'shell-integration.bash')
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

export function shellIntegrationFileZsh(env: NodeJS.ProcessEnv): string {
  return join(configDir(env), 'shell-integration.zsh')
}

/** What the user pastes into ~/.zshrc. Kept on one line so it copies cleanly. */
export const RC_LINE_ZSH =
  '[ -f ~/.config/termspace/shell-integration.zsh ] && . ~/.config/termspace/shell-integration.zsh'

/*
 * zsh has a real preexec whose $1 is the line as typed, before alias expansion,
 * so none of the DEBUG-trap machinery above is needed. It also sends OSC 7:
 * macOS has no /proc for pty-host's cwd fallback to read, so the shell has to
 * say where it is.
 *
 * `terminal-signals.parseCwd` runs the payload through decodeURIComponent, so a
 * literal % in a path would read as an escape and the whole report would be
 * dropped. % is escaped first, then the characters a URL would end the path on.
 * Everything else, UTF-8 included, passes through and decodes to itself.
 */
export const HOOK_SCRIPT_ZSH = `# Termspace shell integration (zsh).
#
# Written by Termspace and overwritten on every launch — edit ~/.zshrc instead.
# Reports the line you submitted, before alias expansion, so "save this layout"
# records the alias you typed rather than what it expanded into, and reports the
# working directory so a saved pane reopens where you left it.

[[ -o interactive ]] || return 0
[ -n "$ZSH_VERSION" ] || return 0
[ "$TERM_PROGRAM" = "Termspace" ] || return 0
command -v base64 >/dev/null 2>&1 || return 0

autoload -Uz add-zsh-hook
# A broken fpath leaves add-zsh-hook undefined; bail rather than print an error
# on every shell start.
(( $+functions[add-zsh-hook] )) || return 0

__termspace_preexec() {
  printf '\\033]1173;C;%s\\007' "$(printf '%s' "$1" | base64 | tr -d '\\n')" \\
    > /dev/tty 2>/dev/null
}

__termspace_cwd() {
  local path=\${PWD//\\%/%25}
  path=\${path// /%20}
  path=\${path//\\#/%23}
  path=\${path//\\?/%3F}
  printf '\\033]7;file://%s%s\\007' "\${HOST}" "$path" > /dev/tty 2>/dev/null
}

add-zsh-hook preexec __termspace_preexec
add-zsh-hook chpwd __termspace_cwd

__termspace_cwd
printf '\\033]1173;A\\007' > /dev/tty 2>/dev/null
`

/** Best-effort: a pane still works without the hook, it just loses what it reports. */
export async function writeShellIntegrationFile(env: NodeJS.ProcessEnv): Promise<void> {
  const path = shellIntegrationFile(env)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, HOOK_SCRIPT, 'utf8')
  await writeFile(shellIntegrationFileZsh(env), HOOK_SCRIPT_ZSH, 'utf8')
}
