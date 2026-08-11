/**
 * The keybindings file. Like settings, the app owns it and writes it back.
 *
 * Only rows that differ from the defaults are written, so a user who never
 * touched the settings screen has no file at all — and a default that changes
 * in a later version reaches them instead of being pinned by a stale copy.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse as parseYaml, stringify } from 'yaml'
import { configDir } from './config-dir'
import { changedBindings, normalizeBindings, type Bindings } from '../shared/keybindings'

/** Which default table the file is read against. Fixed for the process's life. */
const IS_MAC = process.platform === 'darwin'

export function keybindingsFile(env: NodeJS.ProcessEnv): string {
  return join(configDir(env), 'keybindings.yaml')
}

const HEADER = `# Termspace keybindings
#
# Only what differs from the defaults is kept here; everything absent uses them.
# The settings screen (Ctrl+, → Shortcuts) rewrites this file.
#
# A chord is modifiers plus a physical key code: Ctrl+Alt+Shift+KeyU.
# Codes are the browser's: KeyA, Digit1, ArrowLeft, Comma, Equal, F11, Numpad0.
# An action may list several chords, or an empty list to unbind it entirely.
`

export async function loadKeybindings(env: NodeJS.ProcessEnv): Promise<Bindings> {
  try {
    return normalizeBindings(parseYaml(await readFile(keybindingsFile(env), 'utf8')), IS_MAC)
  } catch {
    return normalizeBindings({}, IS_MAC) // Missing or malformed — use defaults
  }
}

export async function saveKeybindings(env: NodeJS.ProcessEnv, raw: unknown): Promise<Bindings> {
  const bindings = normalizeBindings(raw, IS_MAC)
  const changed = changedBindings(bindings, IS_MAC)
  const path = keybindingsFile(env)

  // Back to stock: remove the file rather than leave an empty one behind.
  if (Object.keys(changed).length === 0) {
    await rm(path, { force: true })
    return bindings
  }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${HEADER}\n${stringify(changed, { lineWidth: 0 })}`, 'utf8')
  return bindings
}
