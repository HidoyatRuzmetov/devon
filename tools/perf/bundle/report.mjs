#!/usr/bin/env node
// H2.9/H4.4/H6.3/H6.4 baseline: full per-extension breakdown of apps/web/dist after
// `pnpm --filter @devon/web build` -- what agentic/scripts/check-bundle.mjs's top-8-JS-chunks view
// leaves out: CSS, fonts, and (very much NOT meant to ship to a browser -- H6.3) sourcemap bytes.
// Run: node tools/perf/bundle/report.mjs [path/to/dist]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { extname, join } from 'node:path'

const dir = process.argv[2] || 'apps/web/dist'
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt'])

function walk(d, acc = []) {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

const files = walk(dir)
const byExt = {}
for (const f of files) {
  const ext = extname(f).toLowerCase() || '(none)'
  const buf = readFileSync(f)
  const delivered = COMPRESSIBLE.has(ext) ? gzipSync(buf).length : buf.length
  byExt[ext] ??= { count: 0, raw: 0, delivered: 0 }
  byExt[ext].count++
  byExt[ext].raw += buf.length
  byExt[ext].delivered += delivered
}

let totalRaw = 0
let totalShippable = 0 // excludes .map -- sourcemaps must never reach a browser in production (H6.3)
console.log(`[bundle-report] ${dir}`)
for (const [ext, d] of Object.entries(byExt).sort((a, b) => b[1].raw - a[1].raw)) {
  totalRaw += d.raw
  if (ext !== '.map') totalShippable += d.delivered
  console.log(
    `  ${ext.padEnd(14)} count=${String(d.count).padEnd(5)} raw=${(d.raw / 1024).toFixed(1).padStart(9)} kB  delivered=${(d.delivered / 1024).toFixed(1).padStart(9)} kB${ext === '.map' ? '  (never served to browsers)' : ''}`,
  )
}
console.log(`[bundle-report] total on disk: ${(totalRaw / 1024).toFixed(1)} kB`)
console.log(`[bundle-report] total shippable to a browser (gzip on compressible, as-is on binary, excl. .map): ${(totalShippable / 1024).toFixed(1)} kB`)
