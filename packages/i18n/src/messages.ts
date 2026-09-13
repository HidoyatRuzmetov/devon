// The catalogue registry. Exposes each locale's messages both as the nested tree (for anything that
// wants structure) and pre-flattened dotted-key dictionaries (matching exactly what
// agentic/scripts/check-i18n.mjs computes, so "the gate is green" and "t() finds the key" are
// never two different claims).
//
// These are the *generated* catalogues (MODULE-GUIDE.md "i18n messages"): `messages/<locale>.json`
// (hand-authored core strings) merged with every `messages/modules/<module>/<locale>.json`, by
// `src/cli/merge-messages.ts` -- `pnpm build`/`pnpm dev` in this package regenerate them, so a module
// dropping in a new message file never requires editing this one.
//
// ONLY THE DEFAULT LOCALE IS STATICALLY IMPORTED (v1.1 integration). The four catalogues together
// are ~168 kB gzipped; before this, every browser downloaded all four in the entry chunk and used
// one, which on its own put the shell 19 kB over `agentic/gates.json`'s 350 kB budget after the v1.1
// merges (measured: `node agentic/scripts/check-bundle.mjs`, 368.7 -> 245.7 kB gz). uz-Latn stays
// static because it is the default and the language the product is written in, so `t()` is never
// unanswerable synchronously on a cold start; the other three arrive as their own chunks via
// `loadCatalogue()`, which `apps/web`/`apps/miniapp` await before first paint and `setLocale()`
// awaits before it switches. Node-side callers that want all four at once and synchronously --
// tests, the CLIs -- import `@devon/i18n/catalogues` once, which registers the rest eagerly and
// restores exactly the old behaviour.
//
// Import attributes are required here: this package is `type: module` + `moduleResolution: NodeNext`,
// and real Node ESM (not just a bundler) refuses a bare `import x from './x.json'` in that mode
// (verified empirically while building this file).
import uzLatn from '../messages/uz-Latn.generated.json' with { type: 'json' }
import { DEFAULT_LOCALE, LOCALES, type Locale } from './locale.js'
import { isDev } from './env.js'

export type MessageTree = { [key: string]: string | MessageTree }

const TREES = new Map<Locale, MessageTree>()
const FLAT = new Map<Locale, Record<string, string>>()

export function flatten(
  tree: MessageTree,
  prefix = '',
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') flatten(value, dotted, out)
    else out[dotted] = value
  }
  return out
}

/** Installs one locale's catalogue. Called once per locale -- by this module for the default, by
 *  `loadCatalogue()` for a lazily fetched one, and by `@devon/i18n/catalogues` for the Node-side
 *  "give me all four now" case. Registering the same locale twice simply replaces it. */
export function registerCatalogue(locale: Locale, tree: MessageTree): void {
  TREES.set(locale, tree)
  FLAT.set(locale, flatten(tree))
}

registerCatalogue(DEFAULT_LOCALE, uzLatn as MessageTree)

/** Whether this locale's strings are in memory right now. `setLocale()` uses it to decide between
 *  switching synchronously and waiting for a chunk. */
export function hasCatalogue(locale: Locale): boolean {
  return FLAT.has(locale)
}

const inFlight = new Map<Locale, Promise<void>>()

async function importCatalogue(locale: Locale): Promise<MessageTree> {
  // A literal specifier per locale, not a computed template string: bundlers only emit a separate
  // chunk for an `import()` they can read statically, and a glob-y dynamic import would pull all
  // four back into one chunk -- the exact thing this file exists to stop.
  switch (locale) {
    case 'uz-Cyrl':
      return (await import('../messages/uz-Cyrl.generated.json', { with: { type: 'json' } }))
        .default as MessageTree
    case 'ru':
      return (await import('../messages/ru.generated.json', { with: { type: 'json' } }))
        .default as MessageTree
    case 'en':
      return (await import('../messages/en.generated.json', { with: { type: 'json' } }))
        .default as MessageTree
    default:
      return uzLatn as MessageTree
  }
}

/** Fetches one locale's catalogue if it is not already in memory. Idempotent and de-duplicated:
 *  two callers racing on the same locale share one import. Resolves immediately for a locale that
 *  is already registered, so callers can await it unconditionally. */
export function loadCatalogue(locale: Locale): Promise<void> {
  if (FLAT.has(locale)) return Promise.resolve()
  const running = inFlight.get(locale)
  if (running) return running
  const started = importCatalogue(locale)
    .then((tree) => {
      registerCatalogue(locale, tree)
    })
    .finally(() => {
      inFlight.delete(locale)
    })
  inFlight.set(locale, started)
  return started
}

const warned = new Set<Locale>()

function missingCatalogue(locale: Locale): void {
  // No fallback to another locale, by this package's own rule (locale.ts: "the other three are
  // peers, not fallbacks -- there is no silent English leakage path"). An unloaded locale yields an
  // empty dictionary, so `translate()` shows its bracketed key exactly as it does for a key that
  // was never translated -- loud, and never a sentence in the wrong language.
  if (!isDev() || warned.has(locale)) return
  warned.add(locale)
  console.error(
    `[i18n] catalogue for "${locale}" is not loaded -- await loadCatalogue("${locale}") before rendering in it, or import "@devon/i18n/catalogues" on Node`,
  )
}

export function messageTree(locale: Locale): MessageTree {
  const tree = TREES.get(locale)
  if (tree) return tree
  missingCatalogue(locale)
  return {}
}

export function flatMessages(locale: Locale): Record<string, string> {
  const flat = FLAT.get(locale)
  if (flat) return flat
  missingCatalogue(locale)
  return {}
}

/** Every dotted key that exists in the default locale -- the same universe check-i18n.mjs treats
 *  as the source of truth (`cfg.locales[0]`, and `DEFAULT_LOCALE` is `LOCALES[0]`). Always answerable:
 *  the default locale is the one catalogue that is never lazy. */
export function knownKeys(): readonly string[] {
  return Object.keys(FLAT.get(LOCALES[0]) ?? {})
}
