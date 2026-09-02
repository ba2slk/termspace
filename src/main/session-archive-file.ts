/**
 * Reads and writes the archived-session list. App-owned, so it sits beside the
 * order file in the config dir rather than in the user's sessions directory.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { configDir } from './config-dir'
import { parseArchive } from './session-archive'

export function archiveFile(env: NodeJS.ProcessEnv): string {
  return join(configDir(env), 'session-archive.json')
}

export async function readArchive(path: string): Promise<string[]> {
  try {
    return parseArchive(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return [] // Missing or corrupt — nothing is archived
  }
}

export async function writeArchive(
  path: string,
  archived: readonly string[],
): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(archived, null, 2)}\n`, 'utf8')
  } catch {
    // A read-only config dir must not break the session list.
  }
}
