/**
 * Reads and writes the session order. App-owned, so it sits beside settings in
 * the config dir rather than in the user's sessions directory.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { configDir } from './config-dir'
import { parseOrder } from './session-order'

export function orderFile(env: NodeJS.ProcessEnv): string {
  return join(configDir(env), 'session-order.json')
}

export async function readOrder(path: string): Promise<string[]> {
  try {
    return parseOrder(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return [] // Missing or corrupt — the listing falls back to creation time
  }
}

export async function writeOrder(path: string, order: readonly string[]): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(order, null, 2)}\n`, 'utf8')
  } catch {
    // A read-only config dir must not break the session list.
  }
}
