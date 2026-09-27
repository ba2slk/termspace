/**
 * Reads and writes the session order. App-owned, so it sits beside settings in
 * the config dir rather than in the user's sessions directory.
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
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
  const directory = dirname(path)
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `.session-order-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, `${JSON.stringify(order, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, path)
  } catch (err) {
    try {
      await unlink(temporary)
    } catch {
      // Preserve the write/rename failure.
    }
    throw err
  }
}
