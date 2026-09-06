#!/usr/bin/env node
// `pnpm --filter @devon/i18n messages:merge` -- regenerates the four `<locale>.generated.json`
// catalogues `src/messages.ts` actually loads (MODULE-GUIDE.md "i18n messages"). A module never edits
// `messages/<locale>.json` (the hand-authored core catalogue) or the `.generated.json` files by hand
// -- it drops its own `messages/modules/<module>/<locale>.json` and this script (wired into
// `pnpm build`/`pnpm dev` below, and re-implemented for the gate itself in
// `agentic/scripts/check-i18n.mjs` so the check never depends on someone having remembered to run it)
// folds every module's tree into the core one, per locale.
//
// Deterministic and idempotent: the same set of module files always produces byte-identical output,
// and a full merge is recomputed from the core file every run -- a key a module removes disappears
// from the next `.generated.json` write instead of lingering forever (the failure mode a script that
// only ever *adds* keys to its own output would have).
import { existsSync, readFileSync, readdirSync, watch, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { LOCALES } from '../locale.js'
import type { MessageTree } from '../messages.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_MESSAGES_DIR = join(__dirname, '..', '..', 'messages')

export function modulesDirOf(messagesDir: string): string {
  return join(messagesDir, 'modules')
}

/** Every module subdirectory under `messages/modules/`, sorted so the merge (and therefore a
 * key-collision error) is deterministic across machines and CI. */
export function listModuleNames(messagesDir: string = DEFAULT_MESSAGES_DIR): string[] {
  const dir = modulesDirOf(messagesDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
}

/** Merges `incoming` (one module's tree for one locale) into `base`, recursively. Throws on any key
 * collision -- a module's key landing on top of an existing string (or vice versa) is a naming
 * mistake the author needs to see immediately, never a silent overwrite. */
export function mergeMessageTree(
  base: MessageTree,
  incoming: MessageTree,
  moduleName: string,
  pathPrefix = '',
): MessageTree {
  const out: MessageTree = { ...base }
  for (const [key, value] of Object.entries(incoming)) {
    const existing = out[key]
    const dotted = `${pathPrefix}${key}`
    const incomingIsTree = value !== null && typeof value === 'object'
    const existingIsTree = existing !== undefined && typeof existing === 'object'
    if (existing !== undefined && incomingIsTree !== existingIsTree) {
      throw new Error(
        `i18n merge: module "${moduleName}" key "${dotted}" collides with an incompatible shape in the base catalogue`,
      )
    }
    out[key] = incomingIsTree
      ? mergeMessageTree(
          (existing as MessageTree) ?? {},
          value as MessageTree,
          moduleName,
          `${dotted}.`,
        )
      : value
  }
  return out
}

/** The merged tree for one locale: the hand-authored core catalogue plus every module's tree for that
 * locale, folded in module-name order. A module that has not shipped a given locale yet is skipped for
 * that locale (not an error here) -- `agentic/scripts/check-i18n.mjs` is what flags a locale gap. */
export function mergeLocale(
  locale: string,
  messagesDir: string = DEFAULT_MESSAGES_DIR,
): MessageTree {
  const corePath = join(messagesDir, `${locale}.json`)
  let merged = JSON.parse(readFileSync(corePath, 'utf8')) as MessageTree
  for (const moduleName of listModuleNames(messagesDir)) {
    const modulePath = join(modulesDirOf(messagesDir), moduleName, `${locale}.json`)
    if (!existsSync(modulePath)) continue
    const moduleTree = JSON.parse(readFileSync(modulePath, 'utf8')) as MessageTree
    merged = mergeMessageTree(merged, moduleTree, moduleName)
  }
  return merged
}

export function writeGeneratedCatalogues(
  messagesDir: string = DEFAULT_MESSAGES_DIR,
  locales: readonly string[] = LOCALES,
): void {
  for (const locale of locales) {
    const merged = mergeLocale(locale, messagesDir)
    writeFileSync(
      join(messagesDir, `${locale}.generated.json`),
      `${JSON.stringify(merged, null, 2)}\n`,
    )
  }
}

function runOnce(): void {
  writeGeneratedCatalogues()
  console.log(
    `[messages:merge] merged ${listModuleNames().length} module(s) into ${LOCALES.length} generated catalogue(s)`,
  )
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  runOnce()
  // `pnpm --filter @devon/i18n dev`: re-merge whenever a module (or the core catalogue) changes, so a
  // module author sees `t()` pick up a new key without a manual rebuild. `recursive: true` covers
  // `messages/modules/**` on Windows and macOS (the platforms this dev script actually targets); a
  // Linux dev machine still gets every top-level change and can re-run `messages:merge` by hand.
  if (process.argv.includes('--watch')) {
    console.log('[messages:merge] watching messages/ for changes ...')
    let pending = false
    watch(DEFAULT_MESSAGES_DIR, { recursive: true }, (_event, filename) => {
      if (!filename || !filename.endsWith('.json') || filename.includes('.generated.json')) return
      if (pending) return
      pending = true
      setTimeout(() => {
        pending = false
        try {
          runOnce()
        } catch (err) {
          console.error('[messages:merge] failed:', err)
        }
      }, 100)
    })
  }
}
