#!/usr/bin/env node
// `npm run lint` for @devon/sentinel. Plain JS by design (ADR-011), so "lint" here means "every file
// parses" (`node --check`) rather than running an ESLint dependency this package deliberately does
// not have. Written as a small Node script, not a shell glob, so it behaves the same under bash and
// under npm's Windows cmd.exe runner (which does not expand `*` itself).
import { readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function listMjsFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...listMjsFiles(full))
    else if (entry.endsWith('.mjs')) out.push(full)
  }
  return out
}

const files = ['src', 'scripts', 'test'].flatMap((d) => listMjsFiles(join(root, d)))
let failed = 0
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
    console.log(`[lint] OK ${file}`)
  } catch (err) {
    failed++
    console.error(`[lint] SYNTAX ERROR ${file}\n${err.stderr?.toString() ?? err.message}`)
  }
}
console.log(`[lint] checked ${files.length} file(s), ${failed} failure(s)`)
process.exit(failed ? 1 : 0)
