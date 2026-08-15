/**
 * User-supplied terminal palettes.
 *
 * Same contract as session files: drop a YAML in the folder and it shows up in
 * the list; the app only reads. Keeps the bundle to MIT-licensed palettes while
 * leaving any other scheme available locally.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { TerminalTheme } from '../shared/terminal-themes'
import { configDir } from './config-dir'

export function themesDir(env: NodeJS.ProcessEnv): string {
  return join(configDir(env), 'themes')
}

const COLOR_KEYS = [
  'background',
  'foreground',
  'cursor',
  'selection',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const

/** These values reach a CSS declaration, so reject anything that isn't a colour. */
function isColor(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return /^#[0-9a-fA-F]{6}$/.test(value.trim()) || /^rgba?\([\d\s.,]+\)$/.test(value.trim())
}

/** All-or-nothing: a half-applied palette is worse than a rejected file. */
export function parseTheme(id: string, raw: unknown): TerminalTheme | null {
  if (raw === null || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>

  const colors: Record<string, string> = {}
  for (const key of COLOR_KEYS) {
    const value = input[key]
    if (!isColor(value)) return null
    colors[key] = value.trim()
  }

  // The signature colour is optional: files written before it existed, and
  // most hand-made ones, simply mean "the blue".
  const accent = isColor(input['accent']) ? input['accent'].trim() : colors['blue']!

  const label = typeof input['label'] === 'string' && input['label'].trim() !== ''
    ? input['label'].trim().slice(0, 40)
    : id

  return {
    id,
    label,
    credit: 'User-supplied palette',
    ...colors,
    accent,
  } as TerminalTheme
}

export async function listUserThemes(env: NodeJS.ProcessEnv): Promise<TerminalTheme[]> {
  const dir = themesDir(env)
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
  } catch {
    return [] // No folder yet is not an error
  }

  const themes: TerminalTheme[] = []
  for (const file of files.sort()) {
    const id = basename(file).replace(/\.ya?ml$/, '')
    try {
      const theme = parseTheme(id, parseYaml(await readFile(join(dir, file), 'utf8')))
      if (theme !== null) themes.push(theme)
    } catch {
      // Malformed YAML — skip this file only
    }
  }
  return themes
}

export const EXAMPLE_THEME = `# Termspace terminal palette
#
# Every YAML file in this folder shows up in the palette list (Ctrl+, → theme).
# The file name is the id, so copy this one and rename it. The app only reads
# this folder; it never writes your files back.
#
# label       the name shown in the settings list
# background  the pane behind the text
# foreground  default text colour
# cursor      the block itself, not the text under it
# selection   drag highlight. Translucent, so the text stays readable
# black…white the eight ANSI colours programs ask for by name
# bright…     their bold variants
# accent      the colour this palette is known by, used for the focused pane
#             border when that setting follows the palette. Optional: the blue
#             is used when it is missing
#
# All twenty colours are required. Miss one and the whole file is skipped —
# a palette that is half yours and half the default helps nobody.
# Quote every value: an unquoted #1b1b1b is a YAML comment.

label: My palette

background: "#1b1b1b"
foreground: "#cfcbc4"
cursor: "#cfcbc4"
selection: "rgba(255,255,255,0.14)"

black: "#3a3733"
red: "#cf7a6a"
green: "#8aa872"
yellow: "#d0a45c"
blue: "#7a9bbf"
magenta: "#a988b0"
cyan: "#79a8a3"
white: "#cfcbc4"

brightBlack: "#6a655e"
brightRed: "#e0907f"
brightGreen: "#a3c088"
brightYellow: "#e6bd74"
brightBlue: "#94b4d6"
brightMagenta: "#c3a2c8"
brightCyan: "#93c1bb"
brightWhite: "#e8e4dc"
`

/** Create the folder with an example before opening it. */
export async function ensureThemesDir(env: NodeJS.ProcessEnv): Promise<string> {
  const dir = themesDir(env)
  await mkdir(dir, { recursive: true })
  try {
    // wx fails if the file exists, so a customised example survives.
    await writeFile(join(dir, 'example.yaml'), EXAMPLE_THEME, { encoding: 'utf8', flag: 'wx' })
  } catch {
    // Already there — leave it
  }
  return dir
}
