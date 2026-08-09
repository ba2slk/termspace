#!/usr/bin/env node
// Rasterises build/icon.svg into the PNG sizes the packager and the launcher
// read. The SVG is the source; running this is the only way the PNGs change.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(root, 'build')

// install-local.mjs reads icon-<size>.png for the hicolor theme and icon.png
// for 512x512; electron-builder picks icon.png out of buildResources.
const SIZES = [32, 48, 64, 128, 256]
const FULL = 512

async function main() {
  const svg = await readFile(join(BUILD, 'icon.svg'))

  // Rendering each size from the vector beats downscaling one big raster: the
  // 32px tile keeps its corner radius instead of smearing it.
  const render = (size) =>
    sharp(svg, { density: (72 * size) / 256 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer()

  for (const size of [...SIZES, FULL]) {
    const name = size === FULL ? 'icon.png' : `icon-${size}.png`
    await writeFile(join(BUILD, name), await render(size))
    console.log(`build/${name}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
