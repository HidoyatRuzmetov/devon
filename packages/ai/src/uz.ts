// Uzbek orthography post-processing for model output (v1.1 AI-AUDIT §5 fix 10).
//
// `packages/i18n/src/normalize-uz.ts` is the canonical implementation and the one `@devon/i18n`
// exports. It is deliberately NOT imported here: `@devon/i18n`'s public entry re-exports `useT`,
// which imports `react`, and `@devon/ai` is loaded by `apps/api` (a Node process with no React in
// its dependency graph at all). Importing the barrel to reach fourteen lines of punctuation-fixing
// would pull React into the API's module graph; importing a deep path (`@devon/i18n/src/...`) would
// break that package's "only the barrel is public" rule. So the rule lives twice, and
// `test/unit/uz.test.ts` pins the two implementations to the same table of cases.
//
// U+02BB MODIFIER LETTER TURNED COMMA (`ʻ`) inside the Oʻ/Gʻ digraphs; U+02BC MODIFIER LETTER
// APOSTROPHE (`ʼ`) everywhere else -- the hamza in "maʼno", "sanʼat".
const APOSTROPHE_LIKE = /['’‘`´ʹʻʼʽ]/g

export function normalizeUzLatn(input: string): string {
  return input.replace(APOSTROPHE_LIKE, (_match, offset: number, full: string) => {
    const prev = full[offset - 1]
    return prev && /[ogOG]/.test(prev) ? 'ʻ' : 'ʼ'
  })
}

/** True when `value` still contains an ASCII apostrophe or backtick where Uzbek Latin needs a
 * modifier letter -- the mechanical assertion every `*.orthography` golden case makes. */
export function hasAsciiApostrophe(value: string): boolean {
  return /['`´’‘]/.test(value)
}

/**
 * Walks any JSON-shaped value and rewrites every string through `normalizeUzLatn`. Applied by
 * `features.ts` to a feature's *output* only when the run's locale is `uz-Latn`, and only to string
 * leaves -- object keys are machine contract (`orderedIds`, `actionKind`) and are never touched.
 *
 * Ids are strings too, and an id containing an apostrophe would be corrupted by this. In practice
 * every id this product generates is a UUID or a short slug, and the `preserveKeys` set below names
 * the id-bearing fields explicitly so the guarantee is structural rather than statistical.
 */
const ID_BEARING_KEY = /(^|[a-z])(id|ids|Id|Ids|refId|cardId|commentId|userId|projectId)$/

export function normalizeUzLatnDeep<T>(value: T): T {
  return walk(value, false) as T
}

function walk(value: unknown, insideIdField: boolean): unknown {
  if (typeof value === 'string') return insideIdField ? value : normalizeUzLatn(value)
  if (Array.isArray(value)) return value.map((item) => walk(item, insideIdField))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = walk(child, ID_BEARING_KEY.test(key))
    }
    return out
  }
  return value
}
