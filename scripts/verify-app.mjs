#!/usr/bin/env node
/**
 * Launch the app, run the self-check and report the verdict.
 *
 * Unit tests cover pure logic only. Whether ptys spawn, keys land, the canvas
 * glides and off-screen panes freeze can only be seen with the app running.
 *
 * Groups run in parallel, one window each, tiled so none covers another — a
 * covered window stops compositing and its measurements become meaningless.
 *
 *   npm run verify:app                  every group, side by side
 *   npm run verify:app -- core motion   only these
 *   npm run verify:app -- --serial      one window, everything in order
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * The check never touches the user's config: XDG_CONFIG_HOME points at its own
 * folder, so it runs under identical conditions whatever the user has set.
 */
/*
 * Kept under home rather than /tmp, which is usually a different filesystem
 * with no working trash — the delete check would fail for no reason there.
 */
const CONFIG_ROOT = join(homedir(), '.cache', 'termspace-selfcheck-config')
/*
 * Raise this as checks are added. On timeout the report says nothing at all
 * about what actually went wrong.
 */
const TIMEOUT_MS = 240_000

/**
 * Must match GROUPS in src/renderer/self-check/index.ts.
 *
 * Launch order matters: the last window opened is the one the desktop hands
 * focus to, and only "motion" needs it — the clipboard cannot be read by a
 * window that is not active.
 */
const GROUPS = ['core', 'chrome', 'sessions', 'motion']

const configHome = (group) => join(CONFIG_ROOT, group)
const sessionDir = (group) => join(configHome(group), 'termspace', 'sessions')

/**
 * The session the check expects, rewritten every run for identical conditions.
 *
 * Total column width must exceed three viewports or nothing ever freezes, since
 * the active region already spans one screen either side.
 */
const VERIFY_SESSION = `name: verify
cwd: "~"

columns:
  - width: 700
    panes:
      - title: one
        command: echo VERIFY_ONE
      - title: two
        command: echo VERIFY_TWO
  - width: 800
    panes:
      - title: three
        command: echo VERIFY_THREE
  - width: 900
    panes:
      - title: four
        command: echo VERIFY_FOUR
  - width: 900
    panes:
      - title: five
        command: echo VERIFY_FIVE
  - width: 900
    panes:
      - title: six
        command: echo VERIFY_SIX
  - width: 900
    panes:
      - title: seven
        command: echo VERIFY_SEVEN
  - width: 900
    panes:
      - title: eight
        command: echo VERIFY_EIGHT
`

/**
 * A second session, so switching between two can be checked at all.
 *
 * The list order follows creation order, not the alphabet, so this file is
 * written before "verify" (see `ensureSession`) to put verify on the second
 * row — the one the held-jump check aims at.
 */
const SPARE_SESSION = `name: spare
cwd: "~"

columns:
  - width: 700
    panes:
      - title: spare one
        command: echo SPARE_ONE
      - title: spare two
        command: echo SPARE_TWO
  - width: 800
    panes:
      - title: spare three
        command: echo SPARE_THREE
`

/**
 * A session the schema refuses — `columns: []` fails `columns.min(1)` in
 * `session-schema.ts` — so the sidebar renders it as an error row. The error
 * row is a real state the sidebar has to handle, and `checkErrorRowStaysDraggable`
 * needs a live one to check that its disabled open button still lets a drag
 * through (a CSS rule happy-dom cannot see). Sessions-group only, and written
 * last, so it lands after spare and verify in creation order.
 *
 * The id starts with "z" on purpose and that prefix is load-bearing — see
 * "Two sessions created in the same tick sorted alphabetically instead of by
 * write order" in `docs/engineering-notes.md`.
 */
const BROKEN_SESSION = `name: selfcheck-broken
cwd: "~"
columns: []
`

/**
 * A config folder per group, wiped every run.
 *
 * Separate, because a group that toggles a setting or saves a session would
 * otherwise change what its neighbours see. Wiped, because a run that dies
 * midway leaves settings flipped, and the next run then fails somewhere that
 * has nothing to do with what changed.
 */
async function ensureSession(group) {
  const dir = sessionDir(group)
  await rm(join(configHome(group), 'termspace'), { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  // Creation order is list order (see SPARE_SESSION above): spare first, so
  // verify lands on the second row.
  await writeFile(join(dir, 'spare.yaml'), SPARE_SESSION, 'utf8')
  await writeFile(join(dir, 'verify.yaml'), VERIFY_SESSION, 'utf8')
  // Only the sessions group needs an error row; written last so it never
  // takes a row position another check's fixed assumption depends on.
  if (group === 'sessions') {
    await writeFile(join(dir, 'zselfcheck-broken.yaml'), BROKEN_SESSION, 'utf8')
  }
}

/** Clean up this repo's electron processes; silent when there are none. */
function killStrays() {
  try {
    execFileSync('pkill', ['-9', '-f', `${root}/node_modules/electron/dist/electron`])
  } catch {
    // pkill returns 1 when nothing matched, which is fine.
  }
}

/**
 * Build once, then run the built app.
 *
 * `electron-vite dev` would start a Vite server per process. Development mode
 * keeps import.meta.env.DEV true, which is what admits the self-check module.
 */
function build() {
  execFileSync('npx', ['electron-vite', 'build', '--mode', 'development'], {
    cwd: root,
    stdio: 'pipe',
    env: { ...process.env, VITE_SELFCHECK: '1' },
  })
}

/** One window running one group. Resolves with its output whatever happens. */
function run(group, tile, total) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['electron', '.'], {
      cwd: root,
      detached: true, // so the whole process group can be killed together
      env: {
        ...process.env,
        VITE_SELFCHECK: '1',
        SELFCHECK_SCOPE: group,
        // Only tile when there is something to tile against.
        ...(total > 1 ? { SELFCHECK_TILE: `${tile}/${total}` } : {}),
        XDG_CONFIG_HOME: configHome(group),
        // Lets the window open where the kernel blocks unprivileged user namespaces.
        ELECTRON_DISABLE_SANDBOX: '1',
      },
    })

    let output = ''
    let done = false
    const finish = (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        process.kill(-child.pid, 'SIGKILL') // negative pid targets the whole group
      } catch {
        child.kill('SIGKILL')
      }
      resolve({ group, output, code })
    }
    const timer = setTimeout(() => finish('timeout'), TIMEOUT_MS)

    const onChunk = (chunk) => {
      const text = String(chunk)
      output += text
      if (text.includes('===== END =====')) finish(0)
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
  })
}

/** The report lines a run printed, without the log prefix. */
function reportLines(output) {
  return output
    .split('\n')
    .filter((line) => line.includes('[SELF-CHECK]'))
    .map((line) => line.replace(/.*\[SELF-CHECK\] ?/, ''))
    .filter((line) => !line.startsWith('====='))
}

async function main() {
  const args = process.argv.slice(2)
  const serial = args.includes('--serial')
  const picked = args.filter((a) => !a.startsWith('--'))
  const groups = serial ? ['all'] : picked.length > 0 ? picked : GROUPS

  const unknown = groups.filter((g) => g !== 'all' && !GROUPS.includes(g))
  if (unknown.length > 0) {
    console.error(`No such group: ${unknown.join(', ')}`)
    console.error(`Known groups: ${GROUPS.join(', ')}`)
    process.exitCode = 1
    return
  }

  // One leftover window is enough to take a lock and kill every run below.
  killStrays()
  for (const group of groups) await ensureSession(group)

  console.log('Building…')
  build()
  console.log(
    groups.length === 1
      ? `Running ${groups[0]}.\n`
      : `Running ${String(groups.length)} groups side by side: ${groups.join(', ')}.\n`,
  )

  const started = Date.now()
  const results = await Promise.all(
    groups.map(async (group, i) => {
      // Stagger, so they open in the order listed rather than racing.
      await new Promise((r) => setTimeout(r, i * 600))
      const result = await run(group, i, groups.length)
      // Say something as each one lands; four silent windows look stuck.
      const took = ((Date.now() - started) / 1000).toFixed(0)
      const verdict =
        result.code === 'timeout' ? 'timed out' : /result: PASS/.test(result.output) ? 'PASS' : 'FAIL'
      console.log(`  ${group}: ${verdict} (${took}s)`)
      return result
    }),
  )
  killStrays() // the group kills can miss grandchildren

  let failed = false
  for (const { group, output, code } of results) {
    console.log(`── ${group} ${'─'.repeat(Math.max(0, 40 - group.length))}`)
    if (code === 'timeout') {
      console.log('  did not finish in time')
      failed = true
      continue
    }
    for (const line of reportLines(output)) console.log(`  ${line}`)
    if (!/result: PASS/.test(output)) failed = true
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(0)
  console.log(`\n${failed ? 'Self-check failed' : 'Self-check passed'} in ${seconds}s`)
  process.exitCode = failed ? 1 : 0
}

void main()
