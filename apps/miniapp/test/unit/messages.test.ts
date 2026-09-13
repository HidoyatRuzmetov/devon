// The four-locale gate for this app.
//
// `agentic/scripts/check-i18n.mjs` scans `apps/web/src` only (`agentic/i18n.config.json`), so the
// Mini App's own strings would otherwise ship unchecked: a `t('miniapp.card.markDone')` with no
// message renders the raw dotted key inside a Telegram sheet, in production, with no error anywhere.
// This test is that gate, scoped to this package: every key the source asks for exists in all four
// locales, the four files have identical shapes, and the Uzbek is written with the real modifier
// letters rather than an apostrophe.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const LOCALES = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const
const MESSAGES_DIR = join(process.cwd(), '..', '..', 'packages', 'i18n', 'messages', 'modules')
const SRC_DIR = join(process.cwd(), 'src')

type Tree = { [key: string]: string | Tree }

function flatten(
  tree: Tree,
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

/** Every module catalogue merged, not just `miniapp/` -- a few keys the Mini App uses (the shared
 * state-view copy, say) legitimately live in another module's file, and a test that only looked at
 * its own would demand a duplicate. */
function catalogue(locale: string): Record<string, string> {
  const merged: Tree = {}
  for (const name of readdirSync(MESSAGES_DIR)) {
    const file = join(MESSAGES_DIR, name, `${locale}.json`)
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    deepMerge(merged, JSON.parse(raw) as Tree)
  }
  const core = join(MESSAGES_DIR, '..', `${locale}.json`)
  deepMerge(merged, JSON.parse(readFileSync(core, 'utf8')) as Tree)
  return flatten(merged)
}

function deepMerge(target: Tree, source: Tree): void {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object') {
      const existing = target[key]
      const next: Tree = existing && typeof existing === 'object' ? existing : {}
      target[key] = next
      deepMerge(next, value)
    } else {
      target[key] = value
    }
  }
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** The keys the source asks for. Literal keys are read straight out; a key built from a template
 * (`miniapp.focus.phase.${phase}`) is expanded against the closed set of values that variable can
 * hold, declared here -- the alternative is a prefix match, which would let a typo through. */
const DYNAMIC_FAMILIES: Record<string, readonly string[]> = {
  'miniapp.events.rsvp.': ['yes', 'no', 'maybe'],
  'miniapp.events.rsvpSaved.': ['yes', 'no', 'maybe'],
  'miniapp.focus.phase.': ['focus', 'short_break', 'long_break'],
  'miniapp.priority.': ['none', 'low', 'medium', 'high', 'urgent'],
  'miniapp.reason.': [
    'assigned',
    'mentioned',
    'due',
    'updated',
    'rsvp',
    'poll',
    'decision',
    'digest',
    'system',
  ],
  'miniapp.role.': ['head', 'member'],
  'miniapp.setup.step.': [
    'bot_token.title',
    'bot_token.body',
    'bot_username.title',
    'bot_username.body',
    'menu_button.title',
    'menu_button.body',
    'link_self.title',
    'link_self.body',
    'members_linked.title',
    'members_linked.body',
    'group_connected.title',
    'group_connected.body',
  ],
}

function keysUsed(): Set<string> {
  const used = new Set<string>()
  for (const file of sourceFiles(SRC_DIR)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/['"`](miniapp\.[A-Za-z0-9_.]*)/g)) {
      const key = match[1]!
      const family = DYNAMIC_FAMILIES[key]
      if (family) for (const value of family) used.add(`${key}${value}`)
      else if (!key.endsWith('.')) used.add(key)
      else throw new Error(`Undeclared dynamic key family in ${file}: ${key}`)
    }
  }
  return used
}

describe('miniapp messages', () => {
  const used = keysUsed()

  it('asks for a non-trivial number of keys (the scanner still works)', () => {
    expect(used.size).toBeGreaterThan(120)
  })

  for (const locale of LOCALES) {
    it(`has every key the source uses in ${locale}`, () => {
      const flat = catalogue(locale)
      const missing = [...used].filter((key) => typeof flat[key] !== 'string').sort()
      expect(missing).toEqual([])
    })

    it(`has no empty string in ${locale}`, () => {
      const flat = catalogue(locale)
      const blank = [...used].filter((key) => flat[key]?.trim() === '').sort()
      expect(blank).toEqual([])
    })
  }

  it('keeps the four locale files structurally identical', () => {
    const base = Object.keys(
      flatten(
        JSON.parse(readFileSync(join(MESSAGES_DIR, 'miniapp', 'uz-Latn.json'), 'utf8')) as Tree,
      ),
    ).sort()
    for (const locale of LOCALES.slice(1)) {
      const other = Object.keys(
        flatten(
          JSON.parse(readFileSync(join(MESSAGES_DIR, 'miniapp', `${locale}.json`), 'utf8')) as Tree,
        ),
      ).sort()
      expect(other, `${locale} differs from uz-Latn`).toEqual(base)
    }
  })

  it('writes Uzbek with the modifier letters, never a typewriter apostrophe', () => {
    // `oʻ`/`gʻ` (U+02BB) is the orthography this product committed to; `o'`/`g'` is the thing that
    // makes an official document look like a chat message.
    for (const locale of ['uz-Latn'] as const) {
      const raw = readFileSync(join(MESSAGES_DIR, 'miniapp', `${locale}.json`), 'utf8')
      const offenders = raw
        .split('\n')
        .filter((line) => /[oOgG]['’`´]/.test(line))
        .map((line) => line.trim())
      expect(offenders).toEqual([])
    }
  })
})
