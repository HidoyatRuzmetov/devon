// Rule-based Uzbek Latin -> Cyrillic transliterator, following the official correspondence table
// (O'zbekiston Respublikasining lotin-kirill alifbo mosligi). This is a mechanical first pass, not
// a linguistic authority: `agentic/ledger/cycles/EPIC-000/ac.md` explicitly puts native-reader
// review of transliterated output out of scope for this epic, and spec.md §14 NIT-9 flags the two
// strings the designer was least confident in. Every `uzCyrl` value this produces should be read as
// "machine-transliterated, pending human review" until that review happens (tracked as a proposed
// backlog item, not solved here).
//
// Longest-match-first over three tiers: (1) digraphs with no single Cyrillic letter (sh, ch, ng),
// (2) the two apostrophe digraphs (oʻ, gʻ) using either canonical modifier letter or a bare ASCII
// apostrophe (real-world text is inconsistent), (3) the y + vowel iotated-vowel digraphs (ya, ye,
// yo, yu -> я, е, ё, ю) which only apply word-initially or after a vowel -- after a consonant, `y`
// is the separate consonant letter й. Everything left over is a 1:1 letter map; the tutuq belgisi
// (hamza) apostrophe becomes ъ; unmapped characters (digits, punctuation, Cyrillic already) pass
// through unchanged.
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'ʻ'])

const DIGRAPHS: ReadonlyArray<readonly [string, string]> = [
  ['sh', 'ш'],
  ['ch', 'ч'],
  ['ng', 'нг'],
  ['ts', 'ц'],
]

const APOSTROPHE_DIGRAPHS: ReadonlyArray<readonly [string, string]> = [
  ['oʻ', 'ў'],
  ['gʻ', 'ғ'],
  ["o'", 'ў'],
  ["g'", 'ғ'],
]

const IOTATED: Readonly<Record<string, string>> = { ya: 'я', ye: 'е', yo: 'ё', yu: 'ю' }

// `e` on its own follows the same word-initial-or-after-vowel rule as the `y` digraphs: "elektron"
// -> "электрон" (word start), "bekor" -> "бекор" (after a consonant, palatalising it, as Cyrillic
// "е" already implies -- not "бэкор").
const SINGLE: Readonly<Record<string, string>> = {
  a: 'а',
  b: 'б',
  d: 'д',
  f: 'ф',
  g: 'г',
  h: 'ҳ',
  i: 'и',
  j: 'ж',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  q: 'қ',
  r: 'р',
  s: 'с',
  t: 'т',
  u: 'у',
  v: 'в',
  x: 'х',
  y: 'й',
  z: 'з',
}

function isWordStartPosition(lower: string, i: number): boolean {
  if (i === 0) return true
  const prev = lower[i - 1] ?? ''
  return !/[a-zʻ]/.test(prev)
}

function applyCase(source: string, lower: string): string {
  if (source.length === 0) return lower
  const firstIsUpper = source[0] !== source[0]?.toLowerCase()
  if (source.length === 1) return firstIsUpper ? lower.toUpperCase() : lower
  const restIsUpper =
    source.slice(1) === source.slice(1).toUpperCase() &&
    source.slice(1) !== source.slice(1).toLowerCase()
  if (firstIsUpper && restIsUpper) return lower.toUpperCase()
  if (firstIsUpper) return lower[0]!.toUpperCase() + lower.slice(1)
  return lower
}

/** Best-effort Latin -> Cyrillic transliteration for the Uzbek terminology seed list
 *  (`terms.json`'s `uzCyrl` field) and any future free-text needing a starting-point Cyrillic
 *  rendering. Never used to derive shell copy that already has a designer-authored Cyrillic form
 *  (spec.md §9) -- those are transcribed verbatim, not machine-generated. */
export function latinToCyrillic(input: string): string {
  let out = ''
  let i = 0
  const lower = input.toLowerCase()
  while (i < input.length) {
    const remaining = lower.slice(i)
    let matched = false

    for (const [latin, cyr] of DIGRAPHS) {
      if (remaining.startsWith(latin)) {
        out += applyCase(input.slice(i, i + latin.length), cyr)
        i += latin.length
        matched = true
        break
      }
    }
    if (matched) continue

    for (const [latin, cyr] of APOSTROPHE_DIGRAPHS) {
      if (remaining.startsWith(latin)) {
        out += applyCase(input.slice(i, i + latin.length), cyr)
        i += latin.length
        matched = true
        break
      }
    }
    if (matched) continue

    const atIotationPosition =
      i === 0 || VOWELS.has(lower[i - 1] ?? '') || isWordStartPosition(lower, i)
    if (remaining[0] === 'y' && remaining.length >= 2) {
      const digraph = remaining.slice(0, 2)
      if (digraph in IOTATED && atIotationPosition) {
        out += applyCase(input.slice(i, i + 2), IOTATED[digraph]!)
        i += 2
        continue
      }
    }
    if (remaining[0] === 'e') {
      out += applyCase(input[i]!, atIotationPosition ? 'э' : 'е')
      i += 1
      continue
    }

    const ch = remaining[0]!
    if (ch === "'" || ch === 'ʼ' || ch === 'ʻ') {
      out += 'ъ'
      i += 1
      continue
    }
    if (ch in SINGLE) {
      out += applyCase(input[i]!, SINGLE[ch]!)
      i += 1
      continue
    }
    out += input[i]
    i += 1
  }
  return out
}
