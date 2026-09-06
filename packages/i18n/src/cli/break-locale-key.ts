#!/usr/bin/env node
// `pnpm --filter @devon/i18n break:ru` / `break:uzc` (design.md §9, AC-3 evidence producer; item
// EPIC-000.3 "Done when": "three deliberate-breakage runs ... each fail check-i18n.mjs, then
// revert cleanly"). Deletes exactly one key from the given locale's message file, runs the real
// `agentic/scripts/check-i18n.mjs` gate as a child process both before and after the deletion, and
// restores the file byte-for-byte in a `finally` -- whether the gate behaved or not.
//
// Honesty note: as of this item, `apps/web` does not exist yet (EPIC-000.7, sequential, builds it
// afterward), and `check-i18n.mjs` exits 1 whenever `cfg.src` ("apps/web/src") is missing while a
// root `package.json` exists (it refuses to pass vacuously pre-scaffold -- see the script itself).
// That means the *overall* exit code is 1 both before and after this script's deletion, for a
// reason that has nothing to do with the induced defect. Proving the four-way-parity check itself
// fired is therefore done by inspecting *stdout* for the specific "keys missing" line naming this
// locale and the deleted key, not by an exit-code delta.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { flatten, type MessageTree } from '../messages.js'
import { LOCALES, type Locale } from '../locale.js'
import { REPO_ROOT } from '../terms.js'

function setDeep(
  obj: Record<string, unknown>,
  dotted: string,
  mutate: (parent: Record<string, unknown>, leaf: string) => void,
): void {
  const parts = dotted.split('.')
  let cur: Record<string, unknown> = obj
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]!] as Record<string, unknown>
  mutate(cur, parts[parts.length - 1]!)
}

function runCheckI18n(): { status: number | null; stdout: string } {
  const result = spawnSync(
    process.execPath,
    [join(REPO_ROOT, 'agentic', 'scripts', 'check-i18n.mjs')],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    },
  )
  return { status: result.status, stdout: result.stdout }
}

function main(): void {
  const arg = process.argv[2]
  if (!arg || !(LOCALES as readonly string[]).includes(arg)) {
    console.error(`usage: break-locale-key.ts <${LOCALES.join('|')}>`)
    process.exit(2)
  }
  const locale = arg as Locale
  const messagePath = join(REPO_ROOT, 'packages', 'i18n', 'messages', `${locale}.json`)
  const original = readFileSync(messagePath, 'utf8')
  const tree = JSON.parse(original) as Record<string, unknown>
  const flat = flatten(tree as MessageTree)
  const victimKey = Object.keys(flat)[0]
  if (!victimKey) {
    console.error('[break-locale-key] message file is empty -- nothing to break')
    process.exit(2)
  }

  const before = runCheckI18n()
  console.log(
    `[break-locale-key] baseline (before breaking anything): check-i18n.mjs exit=${before.status}`,
  )

  let deletedValue: unknown
  setDeep(tree, victimKey, (parent, leaf) => {
    deletedValue = parent[leaf]
    delete parent[leaf]
  })

  try {
    writeFileSync(messagePath, JSON.stringify(tree, null, 2) + '\n', 'utf8')
    console.log(
      `[break-locale-key] deleted "${victimKey}" (was ${JSON.stringify(deletedValue)}) from ${locale}.json`,
    )
    const after = runCheckI18n()
    console.log(after.stdout)
    console.log(`[break-locale-key] after breaking: check-i18n.mjs exit=${after.status}`)

    const parityLineFired = new RegExp(
      `\\[i18n\\] ${locale}: \\d+ keys? missing.*${escapeRegExp(victimKey)}`,
    ).test(after.stdout)
    const preScaffold = before.status !== 0 && after.stdout.includes('pre-scaffold')
    if (parityLineFired) {
      console.log(
        `[break-locale-key] OK -- the four-way-parity check reported "${victimKey}" missing from ${locale}`,
      )
      process.exitCode = 0
    } else if (preScaffold) {
      console.log(
        `[break-locale-key] INCONCLUSIVE -- check-i18n.mjs short-circuits on its "apps/web/src not found ` +
          `(pre-scaffold)" branch before it ever reaches the four-way-parity check (see the script itself). ` +
          `This is expected at this stage of EPIC-000 (EPIC-000.7, sequential, has not landed apps/web yet) ` +
          `and is not a defect in @devon/i18n -- re-run this script once apps/web/src exists to get a real ` +
          `pass/fail. Not treated as a pass.`,
      )
      process.exitCode = 1
    } else {
      console.log(
        `[break-locale-key] FAIL -- no "keys missing" line named "${victimKey}" for ${locale} -- the gate has a hole`,
      )
      process.exitCode = 1
    }
  } finally {
    writeFileSync(messagePath, original, 'utf8')
    console.log(`[break-locale-key] reverted ${locale}.json`)
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

main()
