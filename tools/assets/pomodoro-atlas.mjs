// Read-only atlas analysis: the ImageGen artwork is never repainted, cropped or repacked.
// Emit registered source/destination rectangles for the canvas player. No pixels are changed.
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import prettierConfig from '../../packages/config/prettier/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sharp = createRequire(resolve(root, 'apps/api/package.json'))('sharp')
const prettier = createRequire(resolve(root, 'apps/api/package.json'))('prettier')
const directory = resolve(root, 'apps/web/src/features/personal/assets')
const output = resolve(root, 'apps/web/src/features/personal/pomodoro-atlas.json')
const round = (n) => Number(n.toFixed(5))
const manifest = {}
const reports = []
const atlases = []
for (const file of readdirSync(directory).filter((name) => name.endsWith('-sprite.webp'))) {
  const name = file.replace('-sprite.webp', '')
  const {
    data,
    info: { width, height, channels },
  } = await sharp(resolve(directory, file)).raw().toBuffer({ resolveWithObject: true })
  if (width !== 1536 || height !== 1024 || channels !== 4) throw new Error(`${name}: invalid sheet`)
  const alpha = (x, y) => data[(y * width + x) * 4 + 3]
  const cuts = []
  function boundary(nominal, scan) {
    let best = nominal,
      bestScore = Infinity,
      countAtBest = 0
    for (let position = nominal - 80; position <= nominal + 80; position++) {
      const count = scan(position)
      const score = count + Math.abs(position - nominal) / 10000
      if (score < bestScore) {
        best = position
        bestScore = score
        countAtBest = count
      }
    }
    cuts.push(countAtBest)
    return best
  }
  const rows = [
    0,
    ...[256, 512, 768].map((nominal) =>
      boundary(nominal, (y) => {
        let count = 0
        for (let x = 0; x < width; x++) if (alpha(x, y) > 32) count++
        return count
      }),
    ),
    height,
  ]
  const frames = []
  for (let row = 0; row < 4; row++) {
    const top = rows[row],
      bottom = rows[row + 1]
    const columns = [
      0,
      ...[256, 512, 768, 1024, 1280].map((nominal) =>
        boundary(nominal, (x) => {
          let count = 0
          for (let y = top; y < bottom; y++) if (alpha(x, y) > 32) count++
          return count
        }),
      ),
      width,
    ]
    for (let column = 0; column < 6; column++) {
      const left = columns[column],
        right = columns[column + 1]
      let minX = right,
        maxX = left,
        minY = bottom,
        maxY = top
      let redMinX = right,
        redMaxX = left,
        redMinY = bottom,
        redMaxY = top
      for (let y = top; y < bottom; y++)
        for (let x = left; x < right; x++) {
          const offset = (y * width + x) * 4
          if (data[offset + 3] < 64) continue
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
          if (data[offset] > data[offset + 1] * 1.5 && data[offset] > data[offset + 2] * 1.4) {
            redMinX = Math.min(redMinX, x)
            redMaxX = Math.max(redMaxX, x)
            redMinY = Math.min(redMinY, y)
            redMaxY = Math.max(redMaxY, y)
          }
        }
      if (redMaxX - redMinX < 60 || redMaxY - redMinY < 60)
        throw new Error(`${name}: missing tomato in frame ${frames.length + 1}`)
      frames.push({
        row,
        column,
        left,
        right,
        top,
        bottom,
        minX,
        maxX,
        minY,
        maxY,
        redMinX,
        redMaxX,
        redMinY,
        redMaxY,
      })
    }
  }
  // Character registration is per frame, not per row. Generated sheets have small changes in
  // framing; anchoring the body removes those camera jumps without repainting the artwork.
  for (const f of frames) {
    f.anchorX = (f.redMinX + f.redMaxX) / 2
    f.anchorY = f.redMaxY
    f.bodyWidth = f.redMaxX - f.redMinX
  }
  atlases.push({ name, width, height, frames, cuts })
}
// One body width for the entire repertoire. Props must fit too, without shrinking just that clip.
let bodySize = 150
for (const { frames } of atlases)
  for (const f of frames) {
    bodySize = Math.min(
      bodySize,
      (120 * f.bodyWidth) / Math.max(f.anchorX - f.minX, f.maxX - f.anchorX),
      (208 * f.bodyWidth) / Math.max(1, f.anchorY - f.minY),
      (32 * f.bodyWidth) / Math.max(1, f.maxY - f.anchorY),
    )
  }
for (const { name, frames, cuts } of atlases) {
  let registrationError = 0
  const rectangles = frames.map((f) => {
    const scale = bodySize / f.bodyWidth
    const x = 128 - f.anchorX * scale,
      y = 216 - f.anchorY * scale
    const rect = [
      f.left,
      f.top,
      f.right - f.left,
      f.bottom - f.top,
      x + f.left * scale,
      y + f.top * scale,
      (f.right - f.left) * scale,
      (f.bottom - f.top) * scale,
    ].map(round)
    const renderedScaleX = rect[6] / rect[2],
      renderedScaleY = rect[7] / rect[3]
    registrationError = Math.max(
      registrationError,
      Math.abs(rect[4] + (f.anchorX - f.left) * renderedScaleX - 128),
      Math.abs(rect[5] + (f.anchorY - f.top) * renderedScaleY - 216),
      Math.abs(f.bodyWidth * renderedScaleX - bodySize),
    )
    return rect
  })
  manifest[name] = rectangles
  reports.push({
    name,
    frames: frames.length,
    bodySize: round(bodySize),
    anchorError: round(registrationError),
    cutPixels: cuts.reduce((a, b) => a + b, 0),
  })
}
if (reports.some((r) => r.cutPixels > 0))
  throw new Error(
    `Nontransparent atlas boundaries: ${JSON.stringify(reports.filter((r) => r.cutPixels > 0))}`,
  )
const contents = await prettier.format(JSON.stringify(manifest), {
  ...prettierConfig,
  parser: 'json',
})
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== contents)
    throw new Error('Pomodoro atlas coordinates are stale; regenerate them')
} else writeFileSync(output, contents)
console.log(JSON.stringify(reports, null, 2))
