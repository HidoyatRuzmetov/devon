// Shared by test/no-destructive-path.test.mjs and scripts/prove.mjs. ADR-011's original guarantee was
// "no destructive path exists anywhere in src/" (EPIC-000, `noop` only); ADR-014 (EPIC-013) narrows it
// to the guarantee that actually matters now that `wipe` is a real command: destructive verbs exist in
// exactly one file, `wipe-executor.mjs`, and nowhere else -- the blast radius is that one small,
// auditable file, never the request-handling code around it. Scans only src/ -- the actual code the
// running service loads -- never test/ (which necessarily names these verbs to test their absence) or
// scripts/ (operator tooling that is not part of the deployed service).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
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

function grep(files) {
  const hits = []
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      for (const re of BANNED) {
        if (re.test(line)) hits.push({ file, line: i + 1, text: line.trim() })
      }
    })
  }
  return hits
}

/**
 * `excludeFiles` (default: none) names files, by basename, that are allowed to contain the banned
 * verbs -- ADR-014's `wipe-executor.mjs` is the one caller that ever passes this. Omitting it
 * reproduces EPIC-000's original, unconditional "nothing in src/ at all" check exactly.
 */
export function checkNoDestructivePath({ excludeFiles = [] } = {}) {
  const files = listMjsFiles(srcDir).filter((f) => !excludeFiles.includes(basename(f)))
  const hits = grep(files)
  return { clean: hits.length === 0, hits, filesChecked: files.length }
}

/** The other half of ADR-014's narrowed guarantee: the excluded file must actually be the one
 * containing the capability (never accidentally empty/renamed elsewhere), so "wipe exists in exactly
 * one place" is proved in both directions, not just the direction that happens to pass trivially. */
export function checkDestructiveFileContainsCapability(fileName) {
  const files = listMjsFiles(srcDir).filter((f) => basename(f) === fileName)
  const hits = grep(files)
  return { found: files.length > 0, hasCapability: hits.length > 0 }
}
