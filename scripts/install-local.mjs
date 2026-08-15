#!/usr/bin/env node
/**
 * Install the built AppImage into ~/Applications with a desktop launcher.
 * Writes only inside the user's home and never needs sudo.
 */
import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const home = homedir()

const APP_DIR = join(home, 'Applications')
const DESKTOP_DIR = join(home, '.local', 'share', 'applications')
const ICON_DIR = join(home, '.local', 'share', 'icons', 'hicolor')
const TARGET = join(APP_DIR, 'Termspace.AppImage')
const DESKTOP_FILE = join(DESKTOP_DIR, 'termspace.desktop')

/**
 * chrome-sandbox inside an AppImage sits on squashfs and cannot be setuid, so
 * --no-sandbox is added only where the kernel blocks unprivileged user
 * namespaces and Electron would otherwise die on launch.
 */
async function needsNoSandbox() {
  try {
    const { stdout } = await run('sysctl', ['-n', 'kernel.apparmor_restrict_unprivileged_userns'])
    return stdout.trim() === '1'
  } catch {
    return false // No such sysctl means no restriction
  }
}

async function appVersion() {
  return JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
}

/*
 * Take the file matching package.json, not the last one by name.
 *
 * Sorting file names is a string sort, where "1.10.4" comes before "1.9.2".
 * That silently installed an old build for every release past 1.9, and the
 * script still reported success because it did copy something.
 */
async function findAppImage() {
  const wanted = `Termspace-${await appVersion()}.AppImage`
  const path = join(root, 'release', wanted)
  try {
    await stat(path)
  } catch {
    throw new Error(`release/${wanted} is missing. Run \`npm run dist\` first.`)
  }
  return path
}

/*
 * Drop the other builds in release/. Every AppImage is 130 MB and nothing reads
 * an old one: the release artifact lives on GitHub, and this script only ever
 * installs the one matching package.json.
 */
async function pruneOldAppImages(keep) {
  const dir = join(root, 'release')
  const removed = []
  for (const name of await readdir(dir)) {
    if (!/^Termspace-.*\.AppImage$/.test(name)) continue
    const path = join(dir, name)
    if (path === keep) continue
    await rm(path)
    removed.push(name)
  }
  return removed
}

async function installIcons() {
  for (const size of [32, 48, 64, 128, 256]) {
    const dir = join(ICON_DIR, `${size}x${size}`, 'apps')
    await mkdir(dir, { recursive: true })
    await copyFile(join(root, 'build', `icon-${size}.png`), join(dir, 'termspace.png'))
  }
  const dir512 = join(ICON_DIR, '512x512', 'apps')
  await mkdir(dir512, { recursive: true })
  await copyFile(join(root, 'build', 'icon.png'), join(dir512, 'termspace.png'))
}

async function main() {
  const source = await findAppImage()

  await mkdir(APP_DIR, { recursive: true })
  // A running AppImage can't be overwritten, so write beside it and rename.
  const staged = `${TARGET}.new`
  await copyFile(source, staged)
  await chmod(staged, 0o755)
  await rename(staged, TARGET)

  await installIcons()
  const pruned = await pruneOldAppImages(source)

  const noSandbox = await needsNoSandbox()
  const exec = noSandbox ? `${TARGET} --no-sandbox` : TARGET

  await mkdir(DESKTOP_DIR, { recursive: true })
  await writeFile(
    DESKTOP_FILE,
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Termspace',
      'Comment=A horizontal-canvas terminal emulator',
      `Exec=${exec} %U`,
      'Icon=termspace',
      'Terminal=false',
      'Categories=System;TerminalEmulator;',
      // Korean keyword stays: this launcher is local, and app-list search is by locale.
      'Keywords=terminal;shell;tmux;터미널;',
      'StartupWMClass=Termspace',
      '',
    ].join('\n'),
    'utf8',
  )
  await chmod(DESKTOP_FILE, 0o644)

  // Refresh the desktop cache where one exists.
  for (const [cmd, args] of [
    ['update-desktop-database', [DESKTOP_DIR]],
    ['gtk-update-icon-cache', ['-f', '-t', ICON_DIR]],
  ]) {
    try {
      await run(cmd, args)
    } catch {
      // Most environments pick it up regardless
    }
  }

  // Print what was installed. Without this a wrong pick looks like a success.
  console.log(`installed  Termspace ${await appVersion()}`)
  console.log(`AppImage   ${TARGET}`)
  console.log(`launcher   ${DESKTOP_FILE}`)
  if (pruned.length > 0) console.log(`pruned     ${pruned.length} older AppImage(s) in release/`)
  console.log('')

  if (!noSandbox) {
    console.log('sandbox    on')
    console.log('')
    console.log('Find Termspace in your app list, or run the AppImage above directly.')
    return
  }

  // Disabling the sandbox is worth saying out loud, along with how to undo it.
  const profilePath = join(APP_DIR, 'termspace-apparmor.profile')
  await writeFile(
    profilePath,
    [
      'abi <abi/4.0>,',
      'include <tunables/global>',
      `profile termspace ${TARGET} flags=(unconfined) {`,
      '  userns,',
      '  include if exists <local/termspace>',
      '}',
      '',
    ].join('\n'),
    'utf8',
  )

  console.log('sandbox    off (--no-sandbox)')
  console.log('')
  console.log('  This system blocks unprivileged user namespaces through AppArmor')
  console.log('  (kernel.apparmor_restrict_unprivileged_userns = 1). chrome-sandbox')
  console.log('  inside an AppImage sits on squashfs and cannot be setuid, so Electron')
  console.log('  would die on launch. The launcher carries --no-sandbox instead.')
  console.log('')
  console.log('  Renderer isolation (contextIsolation, nodeIntegration: false,')
  console.log('  sandbox: true) and the CSP stay in place. What is off is the')
  console.log('  Chromium process sandbox.')
  console.log('')
  console.log('  To turn it on properly (needs sudo):')
  console.log('')
  console.log(`    sudo cp ${profilePath} /etc/apparmor.d/termspace`)
  console.log('    sudo apparmor_parser -r /etc/apparmor.d/termspace')
  console.log(`    sed -i 's/ --no-sandbox//' ${DESKTOP_FILE}`)
  console.log('')
  console.log('Find Termspace in your app list, or run the AppImage above directly.')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
