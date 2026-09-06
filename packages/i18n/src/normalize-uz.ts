// Canonicalises the apostrophe-like characters people actually type (a straight `'`, a backtick, a
// curly quote from a phone keyboard, the modifier-letter apostrophe `ʼ`) into the two correct
// Uzbek Latin glyphs (DESIGN.md §2.3): U+02BB `ʻ` (MODIFIER LETTER TURNED COMMA) inside the Oʻ/Gʻ
// digraphs, and U+02BC `ʼ` (MODIFIER LETTER APOSTROPHE) everywhere else -- the hamza in words like
// "maʼno" / "sanʼat". This runs "on save" (§1.3): a card title, a name, a comment typed with a
// keyboard that has no U+02BB key must not ship with a straight quote or a box glyph.
//
// Deliberately does NOT lower-case: this is a punctuation fixer applied to arbitrary free text
// (titles, names, comments), and silently changing the case of what someone typed would be a
// second, unrelated, surprising transformation. Case-insensitive comparison (used by
// `terms:verify`, `src/terms.ts`) is the caller's job, on top of this function's output.
const APOSTROPHE_LIKE = /['’‘`´ʹʻʼʽ]/g

export function normalizeUz(input: string): string {
  return input.replace(APOSTROPHE_LIKE, (_match, offset: number, full: string) => {
    const prev = full[offset - 1]
    return prev && /[ogOG]/.test(prev) ? 'ʻ' : 'ʼ'
  })
}
