// Reads `packages/i18n/messages/<locale>.json` directly (read-only -- this item DOES NOT touch
// `packages/i18n`) so every assertion in this suite that checks visible copy quotes the same source
// of truth `agentic/scripts/check-i18n.mjs` and `@devon/i18n`'s `t()` do, instead of a second,
// hand-typed copy of the string that could silently drift from a future wording change.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './env.js'
import type { TestLocale } from './locale.js'

type Messages = Record<string, unknown>

const cache = new Map<TestLocale, Record<string, string>>()

function flatten(
  obj: Messages,
  prefix = '',
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') flatten(value as Messages, path, out)
    else out[path] = String(value)
  }
  return out
}

function loadLocale(locale: TestLocale): Record<string, string> {
  const cached = cache.get(locale)
  if (cached) return cached
  const raw = readFileSync(
    join(REPO_ROOT, 'packages', 'i18n', 'messages', `${locale}.json`),
    'utf8',
  )
  const flat = flatten(JSON.parse(raw) as Messages)
  cache.set(locale, flat)
  return flat
}

/** `params` does the same `{name}`-style interpolation `@devon/i18n`'s real `t()` does, for the small
 * number of keys this suite needs to assert with a variable in them (e.g. `home.greeting.*`). */
export function message(locale: TestLocale, key: string, params?: Record<string, string>): string {
  const flat = loadLocale(locale)
  const template = flat[key]
  if (template === undefined) {
    throw new Error(`[messages] no key "${key}" in packages/i18n/messages/${locale}.json`)
  }
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}
