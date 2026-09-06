// Shared by test/no-destructive-path.test.mjs and scripts/prove.mjs: "no destructive path exists in
// this epic's sentinel code" (ADR-011) is a grep result, not a claim. Scans only src/ -- the actual
// code the running service loads -- never test/ (which necessarily names these verbs to test their
// absence) or scripts/ (operator tooling that is not part of the deployed service).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, '..', '..', 'src')

// No trailing word boundary on rm/unlink: it must also catch rmSync, rmdirSync, unlinkSync. Volume
// and the container-runtime name are matched as prefixes for the same reason (plurals, adjectives).
const BANNED = [/\brm\w*/i, /\bunlink\w*/i, /\bdocker/i, /\bvolume/i]

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

export function checkNoDestructivePath() {
  const files = listMjsFiles(srcDir)
  const hits = []
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      for (const re of BANNED) {
        if (re.test(line)) hits.push({ file, line: i + 1, text: line.trim() })
      }
    })
  }
  return { clean: hits.length === 0, hits, filesChecked: files.length }
}
