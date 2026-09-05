// TS mirror of `app.normalize_uz()` in `migrations/0006_normalize_uz.sql`. Two independent
// implementations of the same folding rule exist on purpose: the SQL one is what search queries
// actually run against inside Postgres (index expressions, `pg_trgm`), and this one lets application
// code (later epics: quick-add parsing, duplicate detection) normalise a string before it ever reaches
// the database, without a round trip. `test/normalize-uz.test.ts`'s live-DB assertion is what keeps
// the two from drifting apart -- if you change one, the other's test fails until you change it too.
//
// Folding is deliberately best-effort for Cyrillic (single-letter approximations, digraphs for
// ц/ч/ш/ё/ю/я): TECH-SPEC §6 and DESIGN §5 assign the real validation against production text to
// EPIC-004's search work. What must not drift before then is that this file and the SQL function agree.

const APOSTROPHES = /[ʻʼʹ‘’'`]/g

const CYRILLIC_DIGRAPHS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ц/g, 's'],
  [/ч/g, 'ch'],
  [/ш/g, 'sh'],
  [/ё/g, 'yo'],
  [/ю/g, 'yu'],
  [/я/g, 'ya'],
]

const CYRILLIC_SINGLE: Readonly<Record<string, string>> = Object.freeze({
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'x',
  ы: 'i',
  э: 'e',
  ў: 'o',
  қ: 'q',
  ғ: 'g',
  ҳ: 'h',
})

const CYRILLIC_SINGLE_RE = new RegExp(`[${Object.keys(CYRILLIC_SINGLE).join('')}]`, 'g')

/** Fold apostrophe variants away and Cyrillic to a Latin-ish approximation, for matching -- not for
 * display. Mirrors `app.normalize_uz(text)`. */
export function normalizeUz(input: string): string {
  let s = input.toLowerCase().replace(APOSTROPHES, '')
  for (const [re, replacement] of CYRILLIC_DIGRAPHS) s = s.replace(re, replacement)
  s = s.replace(CYRILLIC_SINGLE_RE, (ch) => CYRILLIC_SINGLE[ch] ?? ch)
  return s
}
